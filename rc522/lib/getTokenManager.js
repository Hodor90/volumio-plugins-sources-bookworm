const CONFIG_PATH = '/data/configuration/system_hardware/rc522/';
const TokenManager = require('./tokenManager');

const getTokenManager = function (logger = console) {
    return new TokenManager(CONFIG_PATH + 'data/tokenmanager.db', logger);
}

module.exports = getTokenManager;