import { cyan, yellowBright, white, redBright, hex, gray } from 'ansis';
import fs from 'fs';
import TelegramCryptoBot from './services/telegram-bot.js';
import fsp from 'fs/promises';
const orange = hex('#FFAB40');
const __dirname = import.meta.dirname;

export default class App {
  static locale = {};
  // eslint-disable-next-line no-control-regex
  static #ansiPattern = /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g;
  static logEntries = [];
  static server;
  /** @type {TelegramCryptoBot} */
  static telegramBot;

  static DataPath = './json';

  static dateNowShort() {
    return new Date().toLocaleString(App.locale.id, {
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
      month: '2-digit',
      day: '2-digit',
      year: 'numeric',
    });
  }

  static timeNow() {
    return new Date().toLocaleTimeString(App.locale.id);
  }

  static log(message, timestamp = false, colorMessage = null) {
    let prefix = '';
    if (timestamp) {
      prefix = cyan`[${App.dateNowShort()}]: `;
    } else prefix = '  ';
    if (colorMessage == null) colorMessage = white;
    let logMessage = `${prefix}${colorMessage`${message}`}`;
    console.log(logMessage);
    App.logEntries.push(App.stripAnsi(logMessage));
  }

  static stripAnsi(text) {
    return text.replace(App.#ansiPattern, '');
  }

  static warning(message) {
    App.log(orange`${message}`);
  }

  static error(message, throwError = true) {
    this.log(redBright`${message}`, true, redBright);
    if (throwError) {
      this.server.close();
      throw new Error(message);
    }
  }

  /**
   *
   * @param {Error} error
   */
  static async rethrow(error) {
    if (error.cause === 'ExchangeAPI') {
      await TelegramCryptoBot.Instance.log(this.logEntries.slice(this.logEntries.length - 3).toString());
      throw error;
    } else throw error;
  }

  static printObject(object, timestamp = true) {
    this.log(JSON.stringify(object, null, 2), timestamp, redBright);
  }

  static getCallerName() {
    // Get stack array
    const orig = Error.prepareStackTrace;
    Error.prepareStackTrace = (error, stack) => stack;
    const { stack } = new Error();
    Error.prepareStackTrace = orig;

    const caller = stack[2];
    return caller ? caller.getFunctionName() : undefined;
  }

  /**
   * @param {string} file
   */
  static readFile(file) {
    return fsp
      .readFile(file, 'utf8')
      .then((data) => JSON.parse(data))
      .catch((error) => {
        App.warning(`File: ${file} not found`);
        App.warning(`Current path: ${__dirname}`);
        App.rethrow(error);
      });
  }

  /**
   * @param {string} file
   */
  static readFileSync(file) {
    try {
      var data = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (error) {
      App.warning(`File: ${file} not found`);
      App.warning(`Current path: ${__dirname}`);
      App.rethrow(error);
    }
    return data;
  }

  /**
   * @param {string} file
   * @param {any} data
   */
  static writeFile(file, data, replacer = null) {
    var path = `${file}.json`;
    let jsonData = JSON.stringify(data, replacer, 2);
    try {
      fs.writeFileSync(path, jsonData);
    } catch (e) {
      App.printObject(jsonData);
      App.error(e.message, false);
      App.error('Error writing to file');
    }

    App.log(`Written ${yellowBright`${file}.json`} to disk`, true);
  }

  /**
   *
   * @param {string} file
   * @param {any} data
   */
  static appendFile(file, data) {
    let jsonData = JSON.stringify(data, null, 2);
    fs.appendFile(file, jsonData, function (err) {
      if (err) {
        console.error('Error writing to file');
        return console.log(err);
      }
    });
  }

  static writeLog() {
    let data = App.logEntries.join('\n');
    data += '\n';
    fs.appendFile('log/app.log', data, function (err) {
      if (err) {
        console.error('Error writing to file');
        return console.log(err);
      }
    });
    App.logEntries = [];
  }

  /**
   *
   * @param {Date} date
   */
  static toShortTime(date) {
    return date.toLocaleString(App.locale.id, {
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    });
  }

  static toShortDate(date) {
    return date.toLocaleString(App.locale.id, {
      month: '2-digit',
      day: '2-digit',
      year: 'numeric',
    });
  }
}
