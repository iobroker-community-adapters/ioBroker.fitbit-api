'use strict';

const request = require('request');
const utils = require('@iobroker/adapter-core'); // Get common adapter utils
const adapterName = require('./package.json').name.split('.').pop();

const BASE_URL = 'https://api.fitbit.com/1/user/';
const BASE2_URL = 'https://api.fitbit.com/1.2/user/';
const clientID = '22BD68';
const clientSecret = 'c4612114c93436901b6affb03a1e5ec8';

let adapter;

function startAdapter(options) {
    options = options || {};
    options = Object.assign({}, options, { name: adapterName });

    adapter = new utils.Adapter(options);

    adapter.on('ready', () => main(adapter));

    return adapter;
}

function getDate() {
    const today = new Date();
    let dd = today.getDate();
    let mm = today.getMonth() + 1;
    const year = today.getFullYear();

    if (mm < 10) {
        mm = '0' + mm;
    }
    if (dd < 10) {
        dd = '0' + dd;
    }

    return `${year}-${mm}-${dd}`;
}

function requestProfile(token, adapter) {
    if (adapter._profilePromise) {
        return adapter._profilePromise;
    }
    const url = `${BASE_URL}-/profile.json`;
    const headers = { Authorization: 'Bearer ' + token };

    adapter._profilePromise = new Promise((resolve, reject) => {
        // read more here: https://dev.fitbit.com/build/reference/web-api/body/

        // const response = {
        //     "user": {
        //         "aboutMe":<value>,
        //         "avatar":<value>,
        //         "avatar150":<value>,
        //         "avatar640":<value>,
        //         "city":<value>,
        //         "clockTimeDisplayFormat":<12hour|24hour>,
        //         "country":<value>,
        //         "dateOfBirth":<value>,
        //         "displayName":<value>,
        //         "distanceUnit":<value>,
        //         "encodedId":<value>,
        //         "foodsLocale":<value>,
        //         "fullName":<value>,
        //         "gender":<FEMALE|MALE|NA>,
        //         "glucoseUnit":<value>,
        //         "height":<value>,
        //         "heightUnit":<value>,
        //         "locale":<value>,
        //         "memberSince":<value>,
        //         "offsetFromUTCMillis":<value>,
        //         "startDayOfWeek":<value>,
        //         "state":<value>,
        //         "strideLengthRunning":<value>,
        //         "strideLengthWalking":<value>,
        //         "timezone":<value>,
        //         "waterUnit":<value>,
        //         "weight":<value>,
        //         "weightUnit":<value>
        //     }
        // };
        request({ url, headers }, (error, response, body) => {
            if (!error && response.statusCode === 200) {
                const data = JSON.parse(body);
                adapter.log.debug('Profile: ' + JSON.stringify(data));

                if (data && data.user) {
                    resolve(data.user);
                } else {
                    reject('User not found');
                }
            } else {
                adapter.log.error('Cannot read profile: ' + (body || error || response.statusCode));
                reject('Cannot read profile: ' + (body || error || response.statusCode));
            }
        });
    });

    return adapter._profilePromise;
}

function requestWeight(token, adapter) {
    const url = `${BASE_URL}-/body/log/weight/date/${getDate()}.json`;
    const headers = { Authorization: 'Bearer ' + token };

    return new Promise((resolve, reject) => {
        // read more here: https://dev.fitbit.com/build/reference/web-api/body/

        // const response = {
        //     "weight":[
        //         {
        //             "bmi":23.57,
        //             "date":"2015-03-05",
        //             "logId":1330991999000,
        //             "time":"23:59:59",
        //             "weight":73,
        //             "source": "API"
        //         },
        //         {
        //             "bmi":22.57,
        //             "date":"2015-03-05",
        //             "logId":1330991999000,
        //             "time":"21:10:59",
        //             "weight":72.5,
        //             "source": "Aria"
        //         }
        //     ]
        // };
        request({ url, headers }, (error, response, body) => {
            if (!error && response.statusCode === 200) {
                const data = JSON.parse(body);
                adapter.log.debug('weight: ' + JSON.stringify(data));

                createObject(token, adapter, 'weight', { role: 'value.health.weight', unit: '%%WEIGHT%%' })
                    .then(() => createObject(token, adapter, 'bmi', { role: 'value.health.bmi' }))
                    .then(() => {
                        if (data && data.weight && data.weight.length) {
                            const value = data.weight.pop();
                            const date = new Date(`${value.date}T${value.time}`);

                            adapter.getState('weight', (err, state) => {
                                if (!state ||
                                    !state.val ||
                                    Math.abs(state.ts - date.getTime()) > 1000 || // one second difference
                                    Math.abs(state.val - value.weight) > 0.1) { // 0.1 difference
                                    adapter.setState('weight', { val: value.weight, ack: true, ts: date.getTime() }, () =>
                                        adapter.setState('bmi', { val: value.bmi, ack: true, ts: date.getTime() }, () =>
                                            resolve()));
                                } else {
                                    resolve();
                                }
                            });
                        } else {
                            reject('Weight is not found');
                        }
                    });
            } else {
                adapter.log.error('Cannot read weight: ' + (body || error || response.statusCode));
                reject('Cannot read weight: ' + (body || error || response.statusCode));
            }
        });
    });
}

function createObject(token, adapter, name, common) {
    return new Promise(resolve => {
        adapter.getObject(name, (err, obj) => {
            if (!obj) {
                requestProfile(token, adapter)
                    .then(user => {
                        obj = {};
                        obj.type = 'state';
                        obj.common = common;
                        obj.common.name = user.displayName + ' ' + name;
                        obj.common.type = obj.common.type || 'number';
                        if (common.unit === '%%WEIGHT%%') {
                            common.unit = user.weightUnit === 'METRIC' ? 'kg' : (user.weightUnit === 'US' ? 'pounds' : 'stone');
                        }
                        obj.common.read = true;
                        obj.common.write = false;
                        obj.native = {};
                        adapter.setObject(name, obj, () => resolve(user));
                    });
            } else {
                resolve();
            }
        });
    });
}

function requestBodyFat(token, adapter) {
    const url = `${BASE_URL}-/body/log/fat/date/${getDate()}.json`;
    const headers = { Authorization: 'Bearer ' + token };

    return new Promise((resolve, reject) => {
        // read more here: https://dev.fitbit.com/build/reference/web-api/body/

        // const response = {
        //     "fat":[
        //         {
        //             "date":"2012-03-05",
        //             "fat":14,
        //             "logId":1330991999000,
        //             "time":"23:59:59",
        //             "source": "API"
        //         },
        //         {
        //             "date":"2012-03-05",
        //             "fat":13.5,
        //             "logId":1330991999000,
        //             "time":"21:20:59",
        //             "source":"Aria"
        //         }
        //     ]
        // };
        request({ url, headers }, (error, response, body) => {
            if (!error && response.statusCode === 200) {
                const data = JSON.parse(body);
                adapter.log.debug('Fat: ' + JSON.stringify(data));

                createObject(token, adapter, 'fat', { role: 'value.health.fat', unit: '%', })
                    .then(() => {
                        if (data && data.fat && data.fat.length) {
                            const value = data.fat.pop();
                            const date = new Date(`${value.date}T${value.time}`);
                            adapter.getState('fat', (err, state) => {
                                if (!state ||
                                    !state.val ||
                                    Math.abs(state.ts - date.getTime()) > 1000 || // one second difference
                                    Math.abs(state.val - value.fat) > 0.1) { // 0.1 difference
                                    adapter.setState('fat', { val: value.fat, ack: true, ts: date.getTime() }, () =>
                                        resolve());
                                } else {
                                    resolve();
                                }
                            });
                        } else {
                            reject('fat is not found');
                        }
                    });
            } else {
                adapter.log.error('Cannot read fat: ' + (body || error || response.statusCode));
                reject('Cannot read fat: ' + (body || error || response.statusCode));
            }
        });
    });
}

function requestActivities(token, adapter) {
    const url = `${BASE_URL}-/activities/date/${getDate()}.json`;
    const headers = { Authorization: 'Bearer ' + token };

    return new Promise((resolve, reject) => {
        // read more here: https://dev.fitbit.com/build/reference/web-api/user/

        // const response = {
        //     "activities":[
        //         {
        //             "activityId":51007,
        //             "activityParentId":90019,
        //             "calories":230,
        //             "description":"7mph",
        //             "distance":2.04,
        //             "duration":1097053,
        //             "hasStartTime":true,
        //             "isFavorite":true,
        //             "logId":1154701,
        //             "name":"Treadmill, 0% Incline",
        //             "startTime":"00:25",
        //             "steps":3783
        //         }
        //     ],
        //     "goals":{
        //         "caloriesOut":2826,
        //         "distance":8.05,
        //         "floors":150,
        //         "steps":10000
        //      },
        //     "summary":{
        //         "activityCalories":230,
        //         "caloriesBMR":1913,
        //         "caloriesOut":2143,
        //         "distances":[
        //             {"activity":"tracker", "distance":1.32},
        //             {"activity":"loggedActivities", "distance":0},
        //             {"activity":"total","distance":1.32},
        //             {"activity":"veryActive", "distance":0.51},
        //             {"activity":"moderatelyActive", "distance":0.51},
        //             {"activity":"lightlyActive", "distance":0.51},
        //             {"activity":"sedentaryActive", "distance":0.51},
        //             {"activity":"Treadmill, 0% Incline", "distance":3.28}
        //         ],
        //         "elevation":48.77,
        //         "fairlyActiveMinutes":0,
        //         "floors":16,
        //         "lightlyActiveMinutes":0,
        //         "marginalCalories":200,
        //         "sedentaryMinutes":1166,
        //         "steps":0,
        //         "veryActiveMinutes":0
        //     }
        // };
        request({ url, headers }, (error, response, body) => {
            if (!error && response.statusCode === 200) {
                const data = JSON.parse(body);
                adapter.log.debug('Profile: ' + JSON.stringify(data));
                createObject(token, adapter, 'steps', { unit: 'steps' })
                    .then(() => createObject(token, adapter, 'restingHeartRate', {
                        desc: {
                            "en": "The number of heart beats per minute while you are at rest",
                            "de": "Die Anzahl der Herzschläge pro Minute im Ruhezustand",
                            "ru": "Количество сердечных сокращений в минуту, пока вы находитесь в состоянии покоя",
                            "pt": "O número de batimentos cardíacos por minuto enquanto você está em repouso",
                            "nl": "Het aantal hartslagen per minuut terwijl u in rust bent",
                            "fr": "Le nombre de battements de coeur par minute lorsque vous êtes au repos",
                            "it": "Il numero di battiti cardiaci al minuto mentre sei a riposo",
                            "es": "La cantidad de latidos del corazón por minuto mientras estás en reposo",
                            "pl": "Liczba uderzeń serca na minutę podczas odpoczynku",
                            "zh-cn": "休息时每分钟的心跳次数"
                        },
                        unit: 'bpm'
                    }))
                    .then(() => createObject(token, adapter, 'calories', { unit: 'kcal' }))
                    .then(() => {
                        if (data && data.summary) {
                            const summary = data.summary;

                            adapter.setState('steps', summary.steps, true);
                            summary.restingHeartRate && adapter.setState('restingHeartRate', summary.restingHeartRate, true);
                            adapter.setState('calories', summary.caloriesOut, true);
                            resolve();
                        } else {
                            reject('Activities not found');
                        }
                    });
            } else {
                adapter.log.error('Cannot read activities: ' + (body || error || response.statusCode));
                reject('Cannot read activities: ' + (body || error || response.statusCode));
            }
        });
    });
}

function requestSleep(token, adapter) {
    const url = `${BASE2_URL}-/sleep/date/${getDate()}.json`;
    // https://api.fitbit.com/1.2/user/-/sleep/date/2020-02-21.json
    const headers = { Authorization: 'Bearer ' + token };

    return new Promise((resolve, reject) => {
        request({ url, headers }, (error, response, body) => {
            adapter.log.error('Trying to get sleep data');
            if (!error && response.statusCode === 200) {
                const data = JSON.parse(body);
                adapter.log.error('Profile: ' + JSON.stringify(data));
                createObject(token, adapter, 'sleepMinutesAsleep', { unit: 'minutes' })
                    .then(() => createObject(token, adapter, 'sleepDeep', {  unit: 'minutes' }))
                    .then(() => createObject(token, adapter, 'sleepLight', { unit: 'minutes' }))
                    .then(() => createObject(token, adapter, 'sleepRem', { unit: 'minutes' }))
                    .then(() => createObject(token, adapter, 'sleepEfficiency'))
                    .then(() => {
                        if (data) {
                            const dataMainSleep = data.sleep.find(el => el.isMainSleep);

                            const minutesAsleep = dataMainSleep.minutesAsleep;
                            const sleepDeep = dataMainSleep.levels.summary.deep.minutes;
                            const sleepLight = dataMainSleep.levels.summary.light.minutes;
                            const sleepRem = dataMainSleep.levels.summary.rem.minutes;
                            const sleepEfficiency = dataMainSleep.efficiency;
                            adapter.log.debug('Data: '+minutesAsleep.toString());
 
                            adapter.setState('sleepMinutesAsleep', minutesAsleep, true);
                            adapter.setState('sleepDeep', sleepDeep, true);
                            adapter.setState('sleepLight', sleepLight, true);
                            adapter.setState('sleepRem', sleepRem, true);
                            adapter.setState('sleepEfficiency', sleepEfficiency, true);
                            resolve();
                        } else {
                            reject('Sleep Records not found');
                        }
                    });
            } else {
                adapter.log.error('Cannot read sleep records: ' + (body || error || response.statusCode));
                reject('Cannot read sleep records: ' + (body || error || response.statusCode));
            }
        });
    });
}

function requestDevices(token, adapter) {
    const url = `${BASE_URL}-/devices.json`;
    const headers = { Authorization: 'Bearer ' + token };

    return new Promise((resolve, reject) => {
        // read more here: https://dev.fitbit.com/build/reference/web-api/devices/

        // const response = [
        //     {
        //         "battery": "High",
        //         "deviceVersion": "Charge HR",
        //         "id": "27072629",
        //         "lastSyncTime": "2015-07-27T17:01:39.313",
        //         "type": "TRACKER"
        //     },
        //     {
        //         "battery": "Empty",
        //         "deviceVersion": "MobileTrack",
        //         "id": "29559794",
        //         "lastSyncTime": "2015-07-19T16:57:59.000",
        //         "type": "TRACKER"
        //     },
        //     {
        //         "battery": "High",
        //         "deviceVersion": "Aria",
        //         "id": "Y1PFEJZGGX8QFYTV",
        //         "lastSyncTime": "2015-07-27T07:14:34.000",
        //         "type": "SCALE"
        //     }
        // ];
        request({ url, headers }, (error, response, body) => {
            if (!error && response.statusCode === 200) {
                const data = JSON.parse(body);
                adapter.log.debug('Devices: ' + JSON.stringify(data));

                const promises = [];
                if (data && data.length) {
                    data.forEach(device => {
                        promises.push(new Promise(resolve => {
                            const id = 'batteryAlarm.' + device.deviceVersion + '_' + device.id;
                            const value = device.battery.toLowerCase() === 'empty';
                            const date = new Date(device.lastSyncTime);

                            adapter.setObjectNotExists(id, {
                                type: 'state',
                                common: {
                                    name: 'Battery status',
                                    type: 'boolean',
                                    role: 'indicator.lowbat',
                                    read: true,
                                    write: false
                                },
                                native: {}
                            }, () =>
                                adapter.getState(id, (err, state) => {
                                    if (!state ||
                                        !state.val ||
                                        Math.abs(state.ts - date.getTime()) > 1000 || // one second difference
                                        value !== state.val) {
                                        adapter.setState(id, { val: value, ack: true, ts: date.getTime() }, () =>
                                            resolve());
                                    } else {
                                        resolve();
                                    }
                                }));
                        }));
                    });
                } else {
                    reject('devices not found');
                }

                Promise.all(promises)
                    .then(() => resolve())
                    .catch(e => reject(e));
            } else {
                adapter.log.error('Cannot read devices: ' + (body || error || response.statusCode));
                reject('Cannot read devices: ' + (body || error || response.statusCode));
            }
        });
    });
}

function checkToken(adapter) {
    return new Promise((resolve, reject) => {
        if (adapter.config.token) {
            adapter.log.debug('Used user token: ' + adapter.config.token);
            return resolve(adapter.config.token);
        }

        adapter.getState('tokens.expire', (err, state) => {
            if (!state || !state.val) {
                reject('No tokens. Please authenticate in configuration');
            } else {
                const time = new Date(state.val);
                // if less then 5 hours
                if (time.getTime() - Date.now() < 4 * 3600000) {
                    adapter.getState('tokens.refresh', (err, state) => {
                        if (!state || !state.val) {
                            reject('No tokens. Please authenticate in configuration');
                        } else {
                            request({
                                url: 'https://api.fitbit.com/oauth2/token',
                                headers: {
                                    Authorization: 'Basic ' + Buffer.from(clientID + ':' + clientSecret).toString('base64'),
                                    'Content-Type': 'application/x-www-form-urlencoded'
                                },
                                method: 'POST',
                                body: 'grant_type=refresh_token&refresh_token=' + state.val
                            }, (error, state, body) => {
                                if (error || state.statusCode !== 200 || !body) {
                                    adapter.log.error('Cannot get new token: ' + (body || error || response.statusCode));
                                    return reject('Cannot get new token: ' + (error || body || state.statusCode || 'NO body'));
                                }

                                if (typeof body !== 'object') {
                                    body = JSON.parse(body);
                                }

                                const time = new Date();
                                time.setSeconds(time.getSeconds() + body.expires_in);
                                adapter.setState('tokens.access', body.access_token, true, () =>
                                    adapter.setState('tokens.refresh', body.refresh_token, true, () =>
                                        adapter.setState('tokens.expire', time.toISOString(), true, () =>
                                            resolve(body.access_token))));
                            });
                        }
                    });
                } else {
                    adapter.getState('tokens.access', (err, state) => resolve(state.val));
                }
            }
        });
    });
}

function main(adapter) {
    checkToken(adapter)
        .then(token => {
            const promises = [];

            adapter.config.weight && promises.push(requestWeight(token, adapter));
            adapter.config.fat && promises.push(requestBodyFat(token, adapter));
            adapter.config.activities && promises.push(requestActivities(token, adapter));
            adapter.config.sleep && promises.push(requestSleep(token, adapter));
            adapter.config.devices && promises.push(requestDevices(token, adapter));

            !promises.length && adapter.log.error('No one option is enabled. Please enable what kind of data do you want to have in adapter configuration!');

            Promise.all(promises)
                .catch(e => adapter.log.error('Cannot read: ' + e))
                .then(() => setTimeout(() => adapter.stop(), 1000));
        }).catch(e => {
            adapter.log.error(e);
            setTimeout(() => adapter.stop(), 1000);
        });
}

// If started as allInOne mode => return function to create instance
if (module.parent) {
    module.exports = startAdapter;
} else {
    // or start the instance directly
    startAdapter();
}