import App from './app.js';
import { cyan, greenBright, yellowBright, white, redBright, hex, gray, cyanBright } from 'ansis';
import CommandLineInterface from './cli.js';
import CryptoBot from '../crypto-bot.js';
import Utils from '../utils.js';
import TerminalKit from 'terminal-kit';
//const orange = hex('#FFAB40');
const orange = '#ffa840';

export default class Terminal {
  static #ansiPattern = /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g;
  #indent = '';
  term = TerminalKit.terminal;
  #prompt = `> `;
  #inputField;
  #cursorStatus = false;
  /** @type {CommandLineInterface} */
  cli;
  logEntries = [];
  #promptStatus = false;

  /** @type {Terminal} */
  static instance;

  /** @type {import('terminal-kit/Terminal.js').AnimatedText} */
  #spinner;
  #document;
  #textBox;
  #inlineInput;

  static get orange() {
    return orange;
  }

  /**
   * @param {CryptoBot} bot
   */
  init(bot) {
    this.bot = bot;
    this.cli = bot.getService('cli');
    this.term.on('key', (name, matches, data) => {
      if (name === 'CTRL_C') {
        App.close();
      }
    });

    this.term.clear();

    this.#document = this.term.createDocument({
      palette: new TerminalKit.Palette(),
    });
    this.#textBox = new TerminalKit.TextBox({
      parent: this.#document,
      //content: text ,
      contentHasMarkup: true,
      scrollable: true,
      vScrollBar: true,
      lineWrap: true,
      //wordWrap: true ,
      x: 1,
      y: 0,
      width: this.term.width - 1,
      height: this.term.height - 2,
    });
    //this.prompt();

    this.#inlineInput = new TerminalKit.InlineInput({
      parent: this.#document,
      textAttr: { color: 'brightGreen' },
      //placeholder: 'Your name here',
      x: 0,
      y: this.term.height - 1,
      //*
      prompt: {
        textAttr: { color: 'yellow' },
        content: `^G> `,
        contentHasMarkup: true,
      },
      //*/
      //firstLineRightShift: 8 ,
      width: 32,
      cancelable: true,
      history: [],
      autoComplete: ['get', 'plan', 'run', 'mcap'],
      autoCompleteMenu: true,
      autoCompleteHint: true,
      autoCompleteHintMinInput: 2,
    });

    this.#inlineInput.on('submit', this.#submitToCli);

    this.term.on('mouse', (name, data) => {
      if (name.endsWith('RELEASED')) this.focusInput();
    });

    this.term.setCursorColorRgb(0, 170, 0);
    this.focusInput();
    Terminal.instance = this;
  }

  get height() {
    return this.term.height;
  }

  get width() {
    return this.term.width;
  }

  async #submitToCli(value) {
    var term = Terminal.instance;
    term.term.moveTo(1, term.height - 1).eraseLineAfter();
    await term.cli.prompt(value);
    term.term.moveTo(1, term.height).eraseLine()('^G> ');
    term.#inlineInput.setContent('');
    term.focusInput();
  }

  setInlineContent(value) {
    this.#inlineInput.setContent(value);
  }

  restoreInput() {
    this.#spinner.animate(false);
    this.term.moveTo(1, this.term.height - 1).eraseLine();
    this.term.hideCursor(false);
    this.#inlineInput.show();
    this.term.moveTo(3, this.term.height).eraseLineAfter();
    this.term.restoreCursor();
    this.#document.giveFocusTo(this.#inlineInput);
  }

  focusInput() {
    this.#document.giveFocusTo(this.#inlineInput);
  }

  async disableInput() {
    this.term.hideCursor(true);
    this.term.saveCursor();
    this.#inlineInput.hide();
    this.term.eraseLine().moveTo(1, this.term.height);
    this.#spinner = await this.term.spinner();
  }

  close() {
    this.term.moveTo(1, this.term.height).eraseLine();
    this.term.processExit(0);
  }

  /**
   * @param {any} prompt
   */
  async yesOrNo(prompt, severity = 1) {
    this.#inlineInput.hide();

    const promptColor = `^[fg:${orange}]`;
    var messageColor = '^G';

    const choices = `${promptColor}[Y/n]`;

    switch (severity) {
      case 0:
        break;

      case 1:
        this.term.setCursorColorRgb(255, 168, 64);
        messageColor = `^[fg:${orange}]`;
        break;

      case 2:
        this.term.setCursorColorRgb(170, 0, 0);
        messageColor = '^R';
        break;
    }
    if (this.#spinner) this.#spinner.animate(false);
    this.term.moveTo(1, this.term.height).eraseLine()(`${promptColor}>^: ${messageColor}${prompt} ${choices} `);
    this.term.hideCursor(false);
    return this.term.yesOrNo({ yes: ['y', 'ENTER'], no: ['n'] }).promise;
  }

  resetPrompt() {
    this.term.eraseLine().column(1);
    this.term.setCursorColorRgb(0, 170, 0);
    this.#inlineInput.setContent('');
    this.#inlineInput.show();
  }

  /**
   *
   * @param {number} n
   */
  setIndent(n) {
    this.#indent = '';
    for (let i = 0; i < n; i++) {
      this.#indent += ' ';
    }
  }

  /**
   *
   * @param {String} prefix
   */
  setIndentString(prefix) {
    this.#indent += prefix;
  }

  log(message, timestamp = false) {
    //this.toggleCursor();
    // this.term.eraseLine().previousLine(1);
    var term = Terminal.instance;
    let prefix = '';
    if (timestamp) {
      prefix = `[^c${App.dateNowShort()}^:]: `;
    } else prefix = term.#indent;

    //if (colorMessage == null) colorMessage = white;

    let logMessage = `${prefix}${message}`;
    // this.term.eraseLine();
    // this.term(logMessage).scrollUp(1);
    //this.logEntries.push(this.stripAnsi(logMessage));
    term.#textBox.appendLog(logMessage);

    // this.term.moveTo(1, this.term.height);
    // if (this.#promptStatus) {
    //   this.term.brightGreen(`${this.#prompt}${this.#inputField.getInput()}`);
    // }
    // this.toggleCursor();
  }

  static log(message) {
    Terminal.instance.log(message, false);
  }

  /**
   * @param {string} message
   */
  static warning(message) {
    Terminal.instance.warning(message);
  }

  /**
   * @param {string} message
   */
  static error(message) {
    Terminal.instance.error(message);
  }

  static stripAnsi(text) {
    return text.replace(this.#ansiPattern, '');
  }

  toggleCursor() {
    this.#cursorStatus = !this.#cursorStatus;
    this.term.hideCursor(this.#cursorStatus);
  }

  /**
   * @param {string} message
   */
  warning(message) {
    this.log(`^y${message}`);
  }

  error(message, throwError = true) {
    this.log(`^R${message}`, true);
    if (throwError) {
      Terminal.log(new Error().stack);
      App.close();
    }
  }

  printObject(object, timestamp = true) {
    this.error(Utils.functionCaller(), false);
    var data = JSON.stringify(object, null, 2).split(`\n`);
    this.log(`${typeof object} <^Y${Object.keys(object)[0]}^:>`);
    for (let i = 0; i < data.length; i++) {
      let line = data[i];
      this.log(`^R${line}`);
    }
  }

  moveUp(y) {
    this.term.moveTo(1, this.term.height - y);
  }

  /**
   *
   * @param {Error} error
   */
  async rethrow(error) {
    if (error.cause === 'ExchangeAPI') {
      var telegramBot = this.bot.getService('telegram');
      await telegramBot.log(this.logEntries.slice(this.logEntries.length - 3).toString());
      throw error;
    } else throw error;
  }

  static printObject(object, timestamp = true) {
    Terminal.instance.printObject(object, timestamp);
  }
}
