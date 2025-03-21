import Utils from '../utils.js';
import CryptoBot from '../crypto-bot.js';
import { yellowBright } from 'ansis';
import fs from 'fs';
import TelegramCryptoBot from '../services/telegram-bot.js';
import fsp from 'fs/promises';
import CommandLineInterface from './cli.js';
import Terminal from './terminal.js';

const __dirname = import.meta.dirname;

export default class App {
  static DataPath = './json';
  static locale = {};

  static server;
  /** @type {TelegramCryptoBot} */
  static telegramBot;
  /** @type {CryptoBot} */
  static bot;

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
        Terminal.warning(`File: ${file} not found`);
        Terminal.warning(`Current path: ${__dirname}`);
        Terminal.rethrow(error);
      });
  }

  /**
   * @param {string} file
   */
  static readFileSync(file) {
    var term = Terminal.instance;
    try {
      var data = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (error) {
      term.warning(`File: ${file} not found`);
      term.warning(`Current path: ${__dirname}`);
      term.rethrow(error);
    }
    return data;
  }

  /**
   * @param {string} file
   * @param {any} data
   */
  static writeFile(file, data, replacer = null) {
    var term = Terminal.instance;
    var path = `${file}.json`;
    let jsonData = JSON.stringify(data, replacer, 2);
    try {
      fs.writeFileSync(path, jsonData);
    } catch (e) {
      term.printObject(jsonData);
      term.error(e.message, false);
      term.error('Error writing to file');
    }

    term.log(`Written ^Y${file}.json^: to disk`, true);
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
        Terminal.error('Error writing to file');
        return Terminal.log(err);
      }
    });
  }

  static writeLog() {
    let data = Terminal.logEntries.join('\n');
    data += '\n';
    fs.appendFile('log/Terminal.log', data, function (err) {
      if (err) {
        Terminal.error('Error writing to file', false);
        return Terminal.log(err);
      }
    });
    Terminal.logEntries = [];
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

  static toDateTime(date) {
    return date.toLocaleString(App.locale.id, {
      month: '2-digit',
      day: '2-digit',
      year: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    });
  }

  static close() {
    this.server.close();

    this.bot.saveAllOrders();
    var term = Terminal.instance;
    term.log('\n');
    term.warning('Exit requested by user');
    term.warning('----- end -----\n');
    term.close();
  }
}
