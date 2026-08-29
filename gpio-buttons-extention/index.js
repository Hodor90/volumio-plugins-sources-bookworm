'use strict';

var libQ = require('kew');
var Gpio = require('onoff').Gpio;
var io = require('socket.io-client');
var socket = io.connect('http://localhost:3000');
var buttons = ["button0", "button1", "button2", "button3", "button4"];


module.exports = GPIOButtonsExtention;
function GPIOButtonsExtention(context) {
	var self = this;

	self.context = context;
	self.commandRouter = self.context.coreCommand;
	self.logger = self.context.logger;
	self.configManager = self.context.configManager;
	self.triggers = [];
	self.lastCmd = null;
	self.lastSocketData = null;
}


GPIOButtonsExtention.prototype.onVolumioStart = function () {
	var self = this;
	var configFile = this.commandRouter.pluginManager.getConfigurationFile(this.context, 'config.json');
	this.config = new (require('v-conf'))();
	this.config.loadFile(configFile);

	self.logger.info("GPIO-Buttons-Extention initialized");

	return libQ.resolve();
}

GPIOButtonsExtention.prototype.onStart = function () {
	var self = this;
	var defer = libQ.defer();


	self.createTriggers()
		.then(function (result) {
			self.logger.info("GPIO-Buttons-Extention started");
			defer.resolve();
		});


	return defer.promise;
};

GPIOButtonsExtention.prototype.onStop = function () {
	var self = this;
	var defer = libQ.defer();

	self.clearTriggers()
		.then(function (result) {
			self.logger.info("GPIO-Buttons-Extention stopped");
			defer.resolve();
		});

	return libQ.resolve();
};

GPIOButtonsExtention.prototype.onRestart = function () {
	var self = this;
	// Optional, use if you need it
};


// Configuration Methods -----------------------------------------------------------------------------

GPIOButtonsExtention.prototype.getUIConfig = function () {
	var defer = libQ.defer();
	var self = this;

	self.logger.info('GPIO-Buttons-Extention: Getting UI config');

	var lang_code = 'en';

	self.commandRouter.i18nJson(__dirname + '/i18n/strings_' + lang_code + '.json',
		__dirname + '/i18n/strings_en.json',
		__dirname + '/UIConfig.json')
		.then(function (uiconf) {

			self.logger.info('Config: ' + JSON.stringify(self.config));

			var i = 0;
			buttons.forEach(function (button, index, array) {

				var enabledDataField = button.concat('Enabled');
				var pinDataField = button.concat('Pin');
				var socketCmdDataField = button.concat('SocketCmd');
				var socketDataDataField = button.concat('SocketData');

				// Strings for config
				var enabledConfig = button.concat('.enabled');
				var pinConfig = button.concat('.pin');
				var socketCmdConfig = button.concat('.socketCmd');
				var socketDataConfig = button.concat('.socketData');

				uiconf.sections[i].content.forEach(element => {
					if (element.id === enabledDataField) {
						self.logger.info('Get ' + enabledDataField + ': ' + self.config.get(enabledConfig));
						element.value = self.config.get(enabledConfig);
					}
					if (element.id === pinDataField) {
						self.logger.info('Get ' + pinDataField + ': ' + self.config.get(pinConfig));
						self.logger.info('Get pinConf Label: ' + self.config.get(pinConfig).toString());

						element.value.value = self.config.get(pinConfig);
						element.value.label = self.config.get(pinConfig).toString();
					}
					if (element.id === socketCmdDataField) {
						self.logger.info('Get ' + socketCmdDataField + ': ' + JSON.stringify(self.config.get(socketCmdConfig)));
						element.value.value = self.config.get(socketCmdConfig);
						element.value.label = self.config.get(socketCmdConfig);
					}
					if (element.id === socketDataDataField) {
						self.logger.info('Get ' + socketDataDataField + ': ' + JSON.stringify(self.config.get(socketDataConfig)));
						element.value.value = self.config.get(socketDataConfig);
						self.logger.info('Get socketDataConf Label: ' + 'Playlist '.concat(self.config.get(socketDataConfig)['name']));
						element.value.label = 'Playlist '.concat(JSON.parse(self.config.get(socketDataConfig))['name']);
					}
				});

				i++;
			});

			defer.resolve(uiconf);
		})
		.fail(function () {
			defer.reject(new Error());
		});

	return defer.promise;
};

GPIOButtonsExtention.prototype.saveConfig = function (data) {
	var self = this;
	self.logger.info('Save: Config ' + JSON.stringify(data));

	let buttonEnabledPropStr = Object.keys(data)[0];
	let regex = /^button\d+/;
	let match = buttonEnabledPropStr.match(regex);

	let button;

	if (match) {
		button = match[0];
		console.log(button); // Ausgabe: button123	
	} else {
		throw new Error("Invalid config: " + JSON.stringify(data));
	}

	// Strings for data fields
	var enabledDataField = button.concat('Enabled');
	var pinDataField = button.concat('Pin');
	var socketCmdDataField = button.concat('SocketCmd');
	var socketDataDataField = button.concat('SocketData');

	// Strings for config
	var enabledConfig = button.concat('.enabled');
	var pinConfig = button.concat('.pin');
	var socketCmdConfig = button.concat('.socketCmd');
	var socketDataConfig = button.concat('.socketData');

	self.config.set(enabledConfig, data[enabledDataField]);
	self.config.set(pinConfig, data[pinDataField]['value']);
	self.config.set(socketCmdConfig, data[socketCmdDataField]['value']);
	self.config.set(socketDataConfig, data[socketDataDataField]['value']);


	self.clearTriggers()
		.then(self.createTriggers());

	self.commandRouter.pushToastMessage('success', "GPIO-Buttons-Extention", "Configuration saved");
};

GPIOButtonsExtention.prototype.createTriggers = function () {
	var self = this;

	self.logger.info('GPIO-Buttons-Extention: Reading config and creating triggers...');

	buttons.forEach(function (button, index, array) {
		var enabledConfig = button.concat('.enabled');
		var pinConfig = button.concat('.pin');

		var enabled = self.config.get(enabledConfig);
		var pin = self.config.get(pinConfig);


		if (enabled === true) {
			self.logger.info('GPIO-Buttons-Extention: ' + button + ' on pin ' + pin);
			var gpioButton = new Gpio(pin + 512, 'in', 'both');
			gpioButton.watch(self.listener.bind(self, button));
			self.triggers.push(gpioButton);
		}
	});

	return libQ.resolve();
};


GPIOButtonsExtention.prototype.clearTriggers = function () {
	var self = this;

	self.triggers.forEach(function (trigger, index, array) {
		self.logger.info("GPIO-Buttons-Extention: Destroying trigger " + index);

		trigger.unwatchAll();
		trigger.unexport();
	});

	self.triggers = [];

	return libQ.resolve();
};


GPIOButtonsExtention.prototype.listener = function (button, err, value) {
	var self = this;

	var socketCmdConfig = button.concat('.socketCmd');
	var socketDataConfig = button.concat('.socketData');

	var socketCmd = self.config.get(socketCmdConfig);
	var socketData = self.config.get(socketDataConfig);

	if (self.lastCmd !== socketCmd || self.lastSocketData !== socketData) {
		self.lastCmd = socketCmd;
		self.lastSocketData = socketData;
		self.logger.info("GPIO-Buttons-Extention listener: " + socketCmd + " triggert with data " + socketData);
		socket.emit(socketCmd, JSON.parse(socketData));
	}
};

GPIOButtonsExtention.prototype.getConfigurationFiles = function () {
	return ['config.json'];
}

GPIOButtonsExtention.prototype.setUIConfig = function (data) {
	var self = this;
	//Perform your installation tasks here
};

GPIOButtonsExtention.prototype.getConf = function (varName) {
	var self = this;
	//Perform your installation tasks here
};

GPIOButtonsExtention.prototype.setConf = function (varName, varValue) {
	var self = this;
	//Perform your installation tasks here
};
