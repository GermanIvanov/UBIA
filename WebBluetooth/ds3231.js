class ds3231 {
    dev_addr = 104;// 0x68;
    stage_read = 0;
    datetimeChanged = null;
    tempChanged = null;
    _log = null;
    _ble = null;
    _new_date = null;


    constructor(params) {
        this._log = params.log;
        this.datetimeChanged = params.datetimeChanged;
        this.tempChanged = params.tempChanged;
    }

    Init(e) {
        this.stage_read = 1;
        this._ble = e.ble;
        this.Write(e, new Uint8Array([0x0E]), new Uint8Array([0x00, 0x88]));
    }

    Loop(e, idx, value) {
        this._ble = e.ble;
        let ds = value.getUint8(0);
        if (idx == 0x0C && ds >= 2) {
            this.log(value, 'din');
            if (this._new_date) {
                this.Write(e, new Uint8Array([0x0]), this._new_date).then(a => {
                    this._new_date = null;
                });
            };
            if (ds >= 9) {
                if (this.datetimeChanged) {
                    let seconds = this._decode(value.getUint8(4));
                    let minutes = this._decode(value.getUint8(5));
                    let hours = this._decodeH(value.getUint8(6));
                    let day = value.getUint8(7);
                    let date = this._decode(value.getUint8(8));
                    let month = this._decode(value.getUint8(9));
                    let year = this._decodeY(value.getUint8(10)) + 2000;
                    this.datetimeChanged(new Date(year, month, date, hours, minutes, seconds, 0));
                }
                this.Read(e, new Uint8Array([0x11]), 2); // читаем температуру
            } else {
                if (ds==4 && this.tempChanged) {
                    let _msb = value.getUint8(4);
                    let _lsb = value.getUint8(5);
                    this.tempChanged(_msb + ((_lsb >> 6) * 0.25));
                }
                this.Read(e, new Uint8Array([0]), 7);  // читаем DateTime
            }
        }
    }


    setDateTime(dstr) {
        var d = new Date(dstr);
        var date_arr = new Uint8Array([
            this._encode(d.getSeconds()),
            this._encode(d.getMinutes()),
            this._encode(d.getHours()),
            this._encode(d.getDay()),
            this._encode(d.getDate()),
            this._encode(d.getMonth()),
            this._encode(d.getFullYear() - 2000) // 34
        ]);
        this._new_date = date_arr;
    }

    async Read(event, reg_addr, len) {
        let blk = new Uint8Array(reg_addr.byteLength + 5);
        blk[0] = blk.byteLength - 2;
        blk[1] = 0x0C;
        blk[2] = reg_addr.byteLength;
        blk[3] = (len & 0x7f) | 0x80;
        blk[4] = (this.dev_addr << 1) & 0xfe;
        blk.set(reg_addr, 5);
        return event.ble.characteristicCache.writeValue(blk);
    }
    async Write(event, reg_addr, data) {
        let blk = new Uint8Array(reg_addr.byteLength + data.byteLength + 5);
        blk[0] = blk.byteLength - 2;
        blk[1] = 0x0C;
        blk[2] = 0x00;
        blk[3] = 0x00;
        blk[4] = (this.dev_addr << 1) & 0xfe;
        blk.set(reg_addr, 5);
        blk.set(data, reg_addr.byteLength + 5);
        return event.ble.characteristicCache.writeValue(blk);
    }

    _decode(value) {
        let decoded = value & 127;
        decoded = (decoded & 15) + 10 * ((decoded & (15 << 4)) >> 4);
        return decoded;
    }

    _decodeH(value) {
        if (value & 128)
            value = (value & 15) + (12 * ((value & 32) >> 5));
        else
            value = (value & 15) + (10 * ((value & 48) >> 4));
        return value;
    }

    _decodeY(value) {
        let decoded = (value & 15) + 10 * ((value & (15 << 4)) >> 4);
        return decoded;
    }

    _encode(value) {
        let encoded = ((value / 10) << 4) + (value % 10);
        return encoded;
    }

    log(o, t) { if (this._log) this._log(o, t); }
}
