'use strict';

const Mfrc522 = require('mfrc522-rpi');
const SoftSPI = require("rpi-softspi");
const serializeUid = require('./serializeUid');

const softSPI = new SoftSPI({
    clock: 23, // pin number of SCLK
    mosi: 19, // pin number of MOSI
    miso: 21, // pin number of MISO
    client: 24 // pin number of CS
});

class MFRC522Daemon {
    constructor(spiChannel, onCardDetected, onCardRemoved, logger = console, interval = 500, debounceThreshold = 5) {
        const mfrc522 = new Mfrc522(softSPI).setResetPin(22);

        const self = this;

        self.interval = interval;
        self.logger = logger;

        self.intervalHandle = null;
        self.currentUID = null;

        self.watcher = function () {
            //# reset card
            mfrc522.reset();

            //# Scan for cards
            let response = mfrc522.findCard();
            //self.logger.info('RC522 daemon: ' + JSON.stringify(response));
            if (!response.status) {
                if (self.currentUID) {
                    if (self.debounceCounter >= debounceThreshold) {
                        onCardRemoved(self.currentUID);
                        self.currentUID = null;
                    } else {
                        self.debounceCounter++;
                    }
                }
            } else {
                const uid = serializeUid(mfrc522.getUid().data);
                //self.logger.info('RC522 daemon: UID serialized: ' + uid);
                self.debounceCounter = 0;
                if (!self.currentUID || self.currentUID !== uid) {
                    self.currentUID = uid;
                    self.logger.info('RC522 daemon: call onCardDetected: ' + self.currentUID);
                    onCardDetected(self.currentUID);
                }
            }
        }
    }

    start() {
        this.logger.info(`RC522 Daemon:going to poll the reader every ${this.interval}ms`);
        this.intervalHandle = setInterval(this.watcher, this.interval);
    }

    stop() {
        clearInterval(this.intervalHandle);
    }
}

module.exports = MFRC522Daemon;