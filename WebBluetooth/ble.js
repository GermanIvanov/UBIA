/*
BLE  
     Version 0.3
*/
class Ble {
  devcnn = 0;
  con_par = {};
  deviceCache = null;
  characteristicCache = null;
  smprate = 2;

  NOT_ADJUST_CONN_PARM = false;
  I2C_DEV_CLK_KHZ = 400;

  stage_init = 0;
  err_rd_i2c = 0;
  start_time = new Date;

  constructor(params) {
    this._log = params.log;
    this.onloop = params.onloop;
    this.onerror = params.onerror;
    this.onsetup = params.onsetup;
  }

  i2cDrvInit(clk_khz) {
    this.log('Init I2C/SMBUS');
    //let blk = new Uint8Array([6 , 1, 0, 0, 255, 255, 0x90, 1]);
    let blk = new Uint8Array([35, 1, 0, 0, 255, 255, clk_khz & 0xff, (clk_khz >> 8) & 0xff, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    this.log(blk, 'dout');
    this.characteristicCache.writeValue(blk);
  }

  handleEvent(event) {
    switch (event.type) {
      case 'gattserverdisconnected':
        let device = event.target;
        if (this.devcnn != 0) {
          this.log('"' + device.name + '" bluetooth device disconnected, trying to reconnect...');
          this.connectDeviceAndCacheCharacteristic(device)
            .then(characteristic => {
              return this.startNotifications(characteristic)
            })
            .catch(error => this.log(error, 'error'));
        }
        break;
      case 'characteristicvaluechanged':
        this.log('characteristicvaluechanged');
        event.ble = this;
        let value = event.target.value.buffer ? event.target.value : new DataView(event.target.value);
        if (value.byteLength > 1) {
          let ds = value.getUint8(0);
          if (ds + 2 >= value.byteLength) {
            let idx = value.getUint8(1);
            if (idx >= 0x80) {
              this.disconnect();
              this.onerror("error", ds);
            } else if (idx == 0x0F) {
              let err_id = value.getUint16(2, true);
              let err_num = value.getUint16(4, true);
              this.disconnect();
              this.onerror('#0F Runtime Error 0x' + this.hex(err_id, 4) + ':' + this.hex(err_num, 4));
            } else if (idx == 0x00 && ds > 3) {
              this.err_rd_i2c = 0;
              this.stage_init = 0;
              let dev_id = value.getUint16(2, true);
              let ver_id = value.getUint16(4, true);
              this.log('#00 DeviceID: ' + this.hex(dev_id, 4) + ', Ver: ' + this.hex(ver_id, 4));
              if ((dev_id & 0xff) != 0x21) {
                disconnect();
                this.onerror('DeviceID: ' + this.hex(dev_id, 4) + ', Ver: ' + this.hex(ver_id, 4) + '\r\nUnknown BLE Device!');
              } else {
                if (this.NOT_ADJUST_CONN_PARM) {
                  log('Init I2c');
                  this.i2cDrvInit(this.I2C_DEV_CLK_KHZ);
                } else {
                  if (this.smprate > 50) this.smprate = 50
                  else if (this.smprate < 1) this.smprate = 1;
                  this.pack_samples = (this.smprate * 44 / 50 + 7) & 0xFE;
                  this.ConnParUpdate(500 / this.smprate); // Set interval 50+ ms (min 7.5 ms)
                  this.GetConnParms();
                }
              }
            } else if (idx == 0x04 && ds >= 16) {
              this.log('#04 Connect parameters [interval (min/max): ' + value.getUint16(2, true) * 1.25 + '/' + value.getUint16(4, true) * 1.25 + ' ms, latency: ' + value.getUint16(6, true) + ', timeout: ' + value.getUint16(8, true) * 10 + ' ms]')
              let cur_interval = value.getUint16(12, true);
              let cur_latency = value.getUint16(14, true);
              let cur_timeout = value.getUint16(16, true);
              this.log('Current Connect parameters (' + value.getUint16(10, true) + ') [interval: ' + cur_interval * 1.25 + ' ms, latency: ' + cur_latency + ', timeout: ' + value.getUint16(16, true) * 10 + ' ms]')
              if (!this.stage_init) {
                if (cur_interval > this.con_par.interval_max
                  || cur_interval < this.con_par.interval_min
                  || cur_latency != this.con_par.latency
                  || cur_timeout != this.con_par.timeout) {
                  if (this.con_par.set == 0) {
                    this.SetConnParms();
                  } else {
                    this.GetConnParms();
                    this.con_par.set--;
                  }
                } else {
                  this.stage_init = 1;
                  this.i2cDrvInit(this.I2C_DEV_CLK_KHZ);
                }
              }
            } else if (idx == 0x03 && ds >= 8) {
              let smpcnt = value.getUint32(2, true);
              let nscnt = value.getUint32(6, true);
              this.log('#03 DevStatus: samples count ' + smpcnt + ', tspcount ' + nscnt);
              let tt = smpcnt - nscnt * pack_samples;
              if (tt > 0) {
                tt = tt * 500 / (Date.now() - start_time);
                this.log('Real sps: ' + tt.toFixed(3) + '?');
              }
            } else if (idx == 0x10 && ds > 3) {
              this.log('#10 I2C(0x' + this.hex(value.getUint8(2), 2) + ') Register[' + this.hex(value.getUint8(3), 2) + '] = ' + this.hex(value.getUint16(4, true), 4));
            } else if (idx == 0x01 && ds >= 38) {
              if (this.onsetup) {
                this.onsetup(event);
              }
            }
            else if (this.onloop) {
              this.onloop(event, idx, value);
            }
          }
        }
        break;
    }
  }

  connect() {
    return (this.deviceCache ? Promise.resolve(this.deviceCache) :
      this.requestBluetoothDevice()).then(
        device => this.connectDeviceAndCacheCharacteristic(device))
      .then(characteristic => this.startNotifications(characteristic))
      .catch(err => {
        this.log(err, 'error');
      });
  }

  connectDeviceAndCacheCharacteristic(device) {
    if (device.gatt.connected && this.characteristicCache) {
      this.log("Reconnect ok");
      return Promise.resolve(this.characteristicCache);
    }
    this.log('Connecting to GATT server...');
    return device.gatt.connect().then(server => {
      this.log('GATT server connected, getting service...');
      return server.getPrimaryService(0xffe0);
    }).then(service => {
      this.log('Service found, getting characteristic...');
      return service.getCharacteristic(0xffe1);
    }).then(characteristic => {
      this.log('Characteristic found');
      this.characteristicCache = characteristic;
      return this.characteristicCache;
    });
  }

  startNotifications(characteristic) {
    this.log('Starting notifications...');
    return characteristic.startNotifications()
      .then(() => {
        this.log('Notifications started');
        characteristic.addEventListener('characteristicvaluechanged', this);
        this.devcnn = 1;
        this.stage_read = 0;
        this.SendWhoIs(this)
        //setTimeout(()=>{this.SendWhoIs(this)}, 500);
      });
  }

  SendWhoIs(e) {
    this.log('Send command #00: WhoIs?');
    let blk = new Uint8Array([0, 0]);
    this.log(blk, 'dout');
    this.characteristicCache.writeValue(blk);
  }

  requestBluetoothDevice() {
    this.log('Requesting bluetooth device...');
    return navigator.bluetooth.requestDevice({
      filters: [{ namePrefix: 'tBLE' }],
      optionalServices: ['0000ffe0-0000-1000-8000-00805f9b34fb', '0000ffe1-0000-1000-8000-00805f9b34fb']
    }).then(device => {
      this.log('"' + device.name + '" bluetooth device selected');
      this.deviceCache = device;
      this.deviceCache.addEventListener('gattserverdisconnected', this);
      return this.deviceCache;
    });
  }

  GetConnParms() {
    this.log('Send command #4: Get current connect parameters...');
    this.characteristicCache.writeValue(new Uint8Array([0, 4]));
  }

  SetConnParms() {
    this.con_par.set = 7;
    this.log('Set Connect parameters #04: interval ' + (this.con_par.interval * 1.25) + ' ms, latency ' + this.con_par.latency + ', timeout ' + (this.con_par.timeout * 10) + ' ms');
    this.characteristicCache.writeValue(new Uint8Array([8, 4,
      this.con_par.interval & 0xff, (this.con_par.interval >> 8) & 0xff,
      this.con_par.interval & 0xff, ((this.con_par.interval >> 8) & 0xff) | 0x80,
      this.con_par.latency, 0, this.con_par.timeout & 0xff, (this.con_par.timeout >> 8) & 0xff]));
  }

  ConnParUpdate(tms) {
    let t = tms / 1.25;
    if (t < 6) t = 6; // min interval 6 * 1.25 = 7.5 ms
    else if (t > 3200) t = 3200; // max interval 0x0C80 * 1.25 = 4000 ms
    t = t & 0xffff;
    let lce = 0; // latency connection events
    this.con_par.interval = t;
    this.con_par.interval_max = t + t / 10; // 10%
    this.con_par.interval_min = t - t / 10;
    if (t < 25) this.con_par.latency = 4;
    else this.con_par.latency = 0;
    // t 6..3200 -> timeout (100..1600)*10 = 1..16 sec
    this.con_par.timeout = (t - 6) * 0.5 + 100; // max tmeout 0x0C80 * 10 = 32000 ms
    this.con_par.set = 0;
    this.log('Connect parameters: interval ' + tms.toFixed(2) + ' ms (real ' + (this.con_par.interval * 1.25) + '), latency ' + this.con_par.latency + ', timeout ' + (this.con_par.timeout * 10) + ' ms');
  }

  disconnect() {
    this.devcnn = 0;
    if (this.deviceCache) {
      this.log('Disconnecting from "' + this.deviceCache.name + '" bluetooth device...');
      this.deviceCache.removeEventListener('gattserverdisconnected', this);
      if (this.deviceCache.gatt.connected) {
        if (this.characteristicCache) {
          this.characteristicCache.stopNotifications()
            .then(_ => {
              this.log('Notifications stopped');
              this.characteristicCache.removeEventListener('characteristicvaluechanged', this);
              if (this.deviceCache.gatt.connected) {
                this.deviceCache.gatt.disconnect();
                this.log('"' + this.deviceCache.name + '" bluetooth device disconnected');
              }
              // this.deviceCache = null;
            })
            .catch(error => {
              this.log(error, 'error');
              if (this.characteristicCache) {
                this.characteristicCache.removeEventListener('characteristicvaluechanged', this);
                this.characteristicCache = null;
              }
              //  this.deviceCache = null;
            });
        }
      }
    }
    else {
      this.log('"' + this.deviceCache.name + '" bluetooth device is already disconnected');
    }
  }

  hex(number, length) {
    var str = (number.toString(16)).toUpperCase();
    while (str.length < length) str = '0' + str;
    return str;
  }
  log(o, t) {
    if (this._log) this._log(o, t);
  }
}