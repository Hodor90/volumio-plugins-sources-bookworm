'use strict';

var libQ = require('kew');
const fs = require('fs-extra');
const io = require('socket.io-client');
const MFRC522Daemon = require('./lib/mfrc522Daemon');
const getTokenManager = require('./lib/getTokenManager');

module.exports = rc522;
function rc522(context) {
	var self = this;

	this.context = context;
	this.commandRouter = this.context.coreCommand;
	this.logger = this.context.logger;
	this.configManager = this.context.configManager;
	self.socket = io.connect('http://localhost:3000');
	self.tokenManager = getTokenManager(self.logger);
}

rc522.prototype.onVolumioStart = function () {
	var self = this;
	var configFile = this.commandRouter.pluginManager.getConfigurationFile(this.context, 'config.json');
	this.config = new (require('v-conf'))();
	this.config.loadFile(configFile);

	return libQ.resolve();
}

rc522.prototype.onStart = function () {
	var self = this;
	var defer = libQ.defer();

	// self.socket.on('playingPlaylist', function (playlist) {//goto guy!
	// 	self.currentPlaylist = playlist;
	// 	self.logger.info('QQQ Currently playing playlist: ' + self.currentPlaylist)
	// });

	//Configuration default values
	if (!self.config.get('spi')) {
		self.config.set('spi', 0);
	}

	if (!self.config.get('pollingRate')) {
		self.config.set('pollingRate', 500);
	}

	if (!self.config.get('debounceThreshold')) {
		self.config.set('debounceThreshold', 1);
	}

	self.registerWatchDaemon()
		.then(function () {
			self.logger.info("RC522 started");
			defer.resolve();
		});

	return defer.promise;
};

rc522.prototype.onStop = function () {
	var self = this;
	var defer = libQ.defer();

	self.unRegisterWatchDaemon()
		.then(function () {
			self.logger.info("RC522 stopped");
			defer.resolve();
		});

	self.socket.removeAllListeners();
	self.socket.off();

	// Once the Plugin has successfull stopped resolve the promise
	defer.resolve();

	return libQ.resolve();
};

rc522.prototype.onRestart = function () {
	var self = this;

	self.unRegisterWatchDaemon()
		.then(() => self.registerWatchDaemon());
};

rc522.prototype.saveTechConfiguration = function (data) {
	const self = this;

	self.logger.info('RC522: Saving config ' + JSON.stringify(data));

	self.config.set('spi', data.spi.value);
	self.config.set('pollingRate', data.pollingRate);
	self.config.set('debounceThreshold', data.debounceThreshold);

	self.commandRouter.pushToastMessage('success', 'RC522', "Configuration saved");

	self.unRegisterWatchDaemon()
		.then(() => self.registerWatchDaemon());
};

rc522.prototype.handleTokenDetected = function (uid) {
	const self = this;

	self.currentTokenUid = uid;
	self.logger.info('Card detected: ' + self.currentTokenUid);

	// We can only play once Volumio is ready to play (has started completely)
	// Thus, we ask Volumio for the state. It will (hopefully) be returned only 
	// once the player's ready - and then we play.
	// If we don't wait, we'll cause an infinite error-reboot-loop
	self.socket.emit('getState', '');
	self.socket.once('pushState', () => { // no, Volumio is ready

		const playlist = self.tokenManager.readToken(self.currentTokenUid);

		self.logger.info('rc522 requesting to play playlist: ' + playlist);

		if (playlist) {
			self.commandRouter.pushToastMessage('success', 'RC522', `requesting to play playlist ${playlist}`);
		} else {
			self.commandRouter.pushToastMessage('success', 'RC522', `An unassigned token (UID ${uid}) has been detected`);
		}

		if (playlist) {
			self.socket.emit('playPlaylist', {
				"name": playlist
			});
		}
	});
}

rc522.prototype.handleTokenRemoved = function (uid) {
	const self = this;
	self.currentTokenUid = null;
	self.logger.info('Card removed: ' + uid);
};


rc522.prototype.registerWatchDaemon = function () {
	const self = this;

	self.logger.info('RC522 Registering a thread to poll the NFC reader');

	const spiChannel = self.config.get('spi');
	const pollingRate = self.config.get('pollingRate');
	const debounceThreshold = self.config.get('debounceThreshold');

	self.logger.info('RC522: SPI channel ' + spiChannel);
	self.logger.info('RC522: polling rate ' + pollingRate);
	self.logger.info('RC522: debounce threshold ' + debounceThreshold);

	self.nfcDaemon = new MFRC522Daemon(spiChannel, self.handleTokenDetected.bind(this), self.handleTokenRemoved.bind(this), self.logger, pollingRate, debounceThreshold);

	self.nfcDaemon.start();
	return libQ.resolve();
};

rc522.prototype.unRegisterWatchDaemon = function () {
	const self = this;

	self.logger.info('RC522: Stopping NFC daemon');
	self.nfcDaemon.stop();
	return libQ.resolve();
};

rc522.prototype.assignPlaylist = function (data) {
	var self = this;

	self.logger.info('Start assignement data: ' + JSON.stringify(data));

	var playlist = data.playlist;

	self.logger.info('Start assignement with playlist: ' + playlist.value);

	self.socket.emit('playPlaylist', { "name": playlist.value });
	self.socket.on('playingPlaylist', function (playlist) {
		if (!self.currentTokenUid) {
			self.commandRouter.pushToastMessage('error', 'RC522', "No NFC token detected");
			return false;
		}
		try {
			if (self.currentTokenUid && playlist && self.tokenManager.assignToken(self.currentTokenUid, playlist)) {
				self.commandRouter.pushToastMessage('success', 'RC522', `Token ${self.currentTokenUid} assigned to ${playlist}`);
				return true;
			} else {
				self.commandRouter.pushToastMessage('error', 'RC522', 'Can not assign UID: ' + currentTokenUid + ' to playlist: ' + playlist);
				return false;
			}
		} catch (err) {
			self.commandRouter.pushToastMessage('error', 'RC522', err.message);
			self.logger.info('RC522: could not assign token uid', self.currentTokenUid, err);
		}
	});


	// self.socket.emit('listPlaylist');
	// self.socket.once('pushListPlaylist', (playlists) => {
	// 	self.logger.info('QQQ playlist ' + playlists);
	// });

	// self.socket.emit('getState', '');
	// self.socket.once('pushState', (state) => {
	// 	self.logger.info('QQQ STATE' + JSON.stringify(state));
	// });

}

// Configuration Methods -----------------------------------------------------------------------------

rc522.prototype.getUIConfig = function () {
	var defer = libQ.defer();
	var self = this;

	var lang_code = this.commandRouter.sharedVars.get('language_code');

	self.logger.info('RC522: getUiConfig with langualge ' + lang_code + ' and load file ' + __dirname + '/i18n/strings_' + lang_code + '.json');

	self.commandRouter.i18nJson(__dirname + '/i18n/strings_' + lang_code + '.json',
		__dirname + '/i18n/strings_en.json',
		__dirname + '/UIConfig.json')
		.then(function (uiconf) {

			self.logger.info('RC522: start getUiConfig preparation');

			const unassignSection = uiconf.sections[1];
			const techSection = uiconf.sections[3];
			const playlistSelectBox = uiconf.sections[0].content[0];

			self.logger.info('RC522: sections loaded');

			// Technical Reader settings
			techSection.content[0].value.value = self.config.get('spi');
			techSection.content[1].value = self.config.get('pollingRate');
			techSection.content[2].value = self.config.get('debounceThreshold');

			self.logger.info('RC522: start lsitPlaylist');

			// finally, we dynamically add the playlist-related informations to the configuration
			// Since this can only be resolved inside a callback and we need to resolve this promise,
			// we do this last in this method
			self.socket.emit('listPlaylist');
			self.socket.once('pushListPlaylist', (playlists) => {

				self.logger.info('RC522: getUiConfig fill select box ' + playlists);

				// fill playlist select box
				playlists.map((playlist) => {
					playlistSelectBox.options.push({ value: playlist, label: playlist });
				});

				// the currently playing playlist is the default
				if (self.currentPlaylist) {
					playlistSelectBox.value.value = self.currentPlaylist;
					playlistSelectBox.value.label = self.currentPlaylist;
				}

				// dynamically create elements for all assigments to delete them
				self.tokenManager.getAllAssignments().map((assignment) => {
					self.logger.info('Found assignment', JSON.stringify(assignment));

					unassignSection.content.push(
						{
							"id": `unassign_${assignment.uid}`,
							"element": "button",
							"label": `${assignment.data}`,
							"onClick": {
								"type": "emit",
								"message": "callMethod",
								"data": {
									"endpoint": "system_hardware/rc522",
									"method": "unassignToken",
									"data": assignment.uid
								}
							}
						});

				})
				self.logger.info('RC522: getUiConfig alles gut');

				defer.resolve(uiconf);
			})
		})
		.fail(function () {
			self.logger.info('RC522: fehler getUiConfig');
			defer.reject(new Error());
		});

	return defer.promise;
};

rc522.prototype.getConfigurationFiles = function () {
	return ['config.json'];
}

rc522.prototype.setUIConfig = function (data) {
	var self = this;
	//Perform your installation tasks here
};

rc522.prototype.getConf = function (varName) {
	var self = this;
	//Perform your installation tasks here
};

rc522.prototype.setConf = function (varName, varValue) {
	var self = this;
	//Perform your installation tasks here
};

rc522.prototype.unassignToken = function (data = null) {
	const self = this;
	const tokenUid = data || self.currentTokenUid;

	self.logger.info('RC522: shall unassign token ' + tokenUid);

	if (!tokenUid) {
		self.commandRouter.pushToastMessage('error', 'RC522', "No NFC token detected");
		return false;
	}

	const unassignedPlaylist = self.tokenManager.unassignToken(tokenUid);
	if (unassignedPlaylist) {
		// self.commandRouter.pushToastMessage('success', 'RC522', `Token ${self.currentTokenUid} unassigned (was ${unassignedPlaylist})`);
		self.commandRouter.pushToastMessage('success', 'RC522', `Token ${tokenUid} unassigned (was ${unassignedPlaylist})`);
	}
}