import { cyan, greenBright, yellowBright, white, redBright, hex, gray, cyanBright, red } from 'ansis';
import App from './app.js';
import CryptoBot from '../crypto-bot.js';
import ExchangeOrder from '../data/exchange-order.js';
import ccxt from 'ccxt';
import coinmarketcap from 'ccxt';
import Terminal from './terminal.js';
import TelegramCryptoBot from '../services/telegram-bot.js';
const orange = hex('#FFAB40');

export default class CommandLineInterface {
  /** @type {CryptoBot} */
  #bot;

  #lastCommand;
  /**
   *
   * @param {CryptoBot} bot
   */
  constructor(bot) {
    this.#bot = bot;
  }

  get #commandString() {
    return `Command <${yellowBright`${this.#lastCommand}`}>`;
  }

  /**
   * @param {string} input
   */
  async prompt(input) {
    var inputArgs = input.split(' ');
    this.#lastCommand = inputArgs[0];

    try {
      switch (this.#lastCommand) {
        case 'b':
        case 'bal':
          await this.getBalance(inputArgs);
          break;

        case 'd':
          await this.downloadBotOrders(inputArgs);
          break;

        case 'fees':
          await this.displayFees(inputArgs);
          break;

        case 'g':
        case 'get':
          await this.getOrder(inputArgs);
          break;

        case 'mcap':
          await this.fetchMarketCapData(inputArgs);
          break;

        case 'plan':
          await this.createPlan(inputArgs);
          break;

        case 'run':
          await this.executeBot(inputArgs);
          break;

        case 't':
          this.messageToTelegram(input.substring(1, input.length));
          this.log(`Message sent`);
          break;

        case 'v':
          await this.verifyOrders(inputArgs);
          break;
        default:
          this.log(`${this.#commandString} not recognised`);
          break;
      }
    } catch (ex) {
      if (!ex.cause) {
        var term = Terminal.instance;
        term.error(ex.message, false);
        term.log(ex.stack);
      }
    }
  }

  /**
   *
   * @param {string} message
   */
  log(message) {
    var term = Terminal.instance;
    term.toggleCursor();
    term.moveUp(1);
    term.term.eraseLine();
    term.term(orange`: ${message}`);
    term.toggleCursor();
  }

  async downloadBotOrders(inputArgs) {
    var botId = inputArgs[1];

    if (!botId) {
      this.log(`${this.#commandString} No ^RbotId^ specified`);
      return;
    }

    if (!this.#bot.hasBot(botId)) {
      this.log(`${this.#commandString} Invalid ^RbotId^ specified`);
      return;
    }

    var term = Terminal.instance;

    var bot = this.#bot.getBotSettings(botId);
    var client = this.#bot.getClient(bot.account);

    var option = inputArgs[2];

    if (bot.strategyType == 'stacker') {
      if (option === '-r') bot.strategy.rebuildHistory(0.5);

      let orders = bot.strategy.strategyOrders.executed.concat(bot.strategy.strategyOrders.pending);
      let missingOrders = orders.filter((txid) => !client.hasLocalOrder(txid));
      if (missingOrders.length > 0) {
        term.log(`Found ^y${orders.length}^ ^Rmissing^ orders`);
        await client.requestOrdersByTxid(missingOrders);
      }
    }
  }

  async executeBot(inputArgs) {
    var botId = inputArgs[1];
    var bot = this.#bot.getBotSettings(botId);
    if (bot) await bot.strategy.decide();
  }

  async createPlan(inputArgs) {
    var term = Terminal.instance;
    term.disableInput();
    term.log(`Creating a new stacker plan.`);
    var accounts = this.#bot.getAccounts();
    if (!accounts || accounts.length == 0) {
      term.log(red(`No accounts connected!`));
      return;
    }
    term.term(redBright(`Which account should this plan use?`));
    term.toggleCursor();
    const accountChoice = await term.term.singleColumnMenu(accounts).promise;
    const account = accountChoice.selectedText;
    var client = this.#bot.getClient(account);
    term.term(redBright(`Which crypto should the bot purchase? Enter the symbol: `));
    term.toggleCursor();
    var cryptos = client
      .getAvailablePairs()
      .map((pair) => pair.split('/')[0].toUpperCase())
      .slice(10);
    var cryptoChoice = await term.term.inputField({
      autoComplete: cryptos,
      autoCompleteMenu: true,
      autoCompleteHint: true,
    }).promise;

    if (!cryptos.includes(cryptoChoice)) cryptoChoice = cryptos.find((crypto) => crypto.startsWith(cryptoChoice));
    const currency = this.#bot.appCurrency.toUpperCase();
    var pair = `${cryptoChoice}/${currency}`;
    var currentPrice = 0;
    var pricePromise = null;

    if (client.prices.has(cryptoChoice.toLowerCase())) {
      currentPrice = client.getPrice(cryptoChoice);
    } else {
      pricePromise = client.requestTicker(pair);
    }

    term.term.scrollUp(1);
    //term.term.green(`-> ${cryptoChoice}`);
    term.term.moveTo(1, term.term.height);
    term.term(redBright(`Choose the frequency of this plan`));
    const frequencyChoice = await term.term.singleColumnMenu(['Recurring (every n-hours)', 'Monthly']).promise;

    var options = {};
    if (frequencyChoice.selectedIndex == 0) {
      term.term(redBright('Enter the frequency (in hours): '));
      const hourChoice = await term.term.inputField().promise;
      options['frequency'] = hourChoice;
    }
    if (frequencyChoice.selectedText === 'Monthly') {
      term.term(redBright('Enter the day of the month: '));
      const dayChoice = await term.term.inputField().promise;
      options['day'] = dayChoice;
      term.term(redBright('Choose bot mode:'));
      const modeChoice = await term.term.singleColumnMenu(['Exact day', 'Closest Monday', 'Closest Saturday', 'Closest Sunday']).promise;
      options['option'] = `closest${modeChoice.selectedText.split(' ')[1].toLowerCase()}`;
    }

    term.term.scrollUp(1);
    term.term.moveTo(1, term.term.height);
    var pairData = client.getPairData(pair.toLowerCase());

    if (pricePromise) {
      currentPrice = (await pricePromise).last;
    }

    var minAmount = (currentPrice * pairData.minVolume).toFixed(pairData.maxQuoteDigits);
    term.term(
      redBright(`Enter how much ${cryptoChoice} in ${currency} you want to purchase (min: ${pairData.minVolume} ${cryptoChoice} / ${minAmount} ${currency}): `),
    );
    const volumeChoice = await term.term.inputField().promise;
    //term.printObject(cryptos.slice(10));
    //term.printObject(plan);

    term.term.scrollUp(1);
    term.term.moveTo(1, term.term.height);
    term.term(redBright('Give a name to this bot: '));
    const botName = await term.term.inputField().promise;
    term.term.scrollUp(1);
    var plan = {
      id: botName,
      account: account,
      strategy: 'stacker',
      base: cryptoChoice.toLowerCase(),
      quote: currency.toLowerCase(),
      pair: pair.toLowerCase(),
      maxVolumeQuote: volumeChoice,
      options: options,
    };
    term.printObject(plan);
  }

  async displayFees(inputargs) {
    var term = Terminal.instance;
    var accounts = this.#bot.getAvailableExchanges();
    term.printObject(accounts);
    for (let i = 0; i < accounts.length; i++) {
      let account = accounts[i];
      let crypto = 'ETH';
      term.log(`Requesting fees for ${yellowBright(crypto)}`);
      let client = this.#bot.getClient(account);
      let r = await client.fetchDepositWithdrawFee('ETH');
      term.log(r);
    }
  }

  /**
   *
   * @param {string[]} inputArgs
   * @returns
   */
  async fetchMarketCapData(inputArgs) {
    var tagsInclude = [];
    var tagsExclude = [];
    var cryptoExclude = [];
    var number = 20;
    if (inputArgs[1] === '--h') {
      this.log(`${this.#commandString} syntax: <n> +[include] -[exclude] --[exclude,symbols]`);
      return;
    }

    for (const arg of inputArgs.slice(1)) {
      let n = Number.parseInt(arg);
      if (!isNaN(n)) {
        number = n;
        continue;
      }

      let options = '';
      let targetArray = tagsInclude;
      if (arg.startsWith('+')) {
        options = arg.replace('+', '');
      } else if (arg.startsWith('--')) {
        cryptoExclude = arg.replace('--', '').split(',');
        continue;
      } else if (arg.startsWith('-')) {
        options = arg.replace('-', '');
        targetArray = tagsExclude;
      }

      if (options.includes('b')) targetArray.push('store-of-value');
      if (options.includes('e')) {
        targetArray.push('ethereum-ecosystem');
      }
      if (options.includes('a')) {
        targetArray.push('pos');
        targetArray.push('layer-1');
        targetArray.push('medium-of-exchange');
      }
      if (options.includes('m')) targetArray.push('memes');
      if (options.includes('s')) targetArray.push('stablecoin');
      if (options.includes('t')) targetArray.push('centralized-exchange');
    }

    return this.#bot.coinmarketcapClient.makeRequest({ tagsInclude, tagsExclude, cryptoExclude, number });
  }

  async verifyOrders(inputArgs) {
    var account = inputArgs[1];
    if (!account) {
      this.log(`${this.#commandString} No account specified`);
      return;
    }

    var client = this.#bot.getClient(account);
    var year = Number(inputArgs[2]);
    var orders = [...client.orders.values()].filter((order) => order.openDate.getFullYear() === year);
    await client.verifyOrders(orders);
    if (year < new Date().getFullYear()) client.archiveOrdersByYear(year);
  }

  async getBalance(inputArgs) {
    var term = Terminal.instance;
    var account = inputArgs[1];
    if (!account) {
      this.log(`${this.#commandString} No account specified`);
      return;
    }

    if (!this.#bot.hasClient(account)) {
      this.log(`${this.#commandString} Invalid client specified`);
      return;
    }

    let client = this.#bot.getClient(account);
    let currencySelection = inputArgs[2];

    var balances = await client.requestBalance();
    let found = false;

    for (const [currency, balance] of balances) {
      if (currencySelection) {
        if (!currencySelection.includes(App.locale.currency) && currency.startsWith(currencySelection)) {
          var pairData = client.getPairData(`${currencySelection}/${App.locale.currency}`);
          var balanceString = balance.toFixed(pairData.minBaseDisplayDigits);
          found = true;
        } else if (currency.includes(App.locale.currency) && currency.startsWith(currencySelection)) {
          balanceString = balance.toFixed(2);
          found = true;
        } else continue;
      } else if (balance > 0) {
        found = true;
        balanceString = balance.toFixed(2);
      } else continue;

      term.log(`|: ^C${currency}^ -> ^G${balanceString}`);
    }

    if (!found) {
      this.log(`${this.#commandString} No balance ^R${currencySelection}^ found on ^C${account}`);
    }
  }

  async messageToTelegram(message) {
    /** @type {TelegramCryptoBot} */
    var telegramBot = this.#bot.getService('telegram');
    return telegramBot.log(message);
  }

  async getOrder(inputArgs) {
    var term = Terminal.instance;
    var account = inputArgs[1];
    let client = this.#bot.getClient(account);
    let txid = inputArgs[2];
    if (!account) {
      this.log(`${this.#commandString} accountId missing: get <accountId> <txid> <options>`);
    }
    if (!txid) {
      this.log(`${this.#commandString} txid missing: get <accountId> <txid> <options>`);
      return;
    }
    let order = await client.requestOrderRaw(txid);
    term.log(`Order <${cyanBright`${txid}`}> downloaded`);
    let options = inputArgs[3];

    switch (options) {
      case '-p':
        term.printObject(client.convertResponseToExchangeOrder(order));
        break;

      case '-r':
        term.printObject(order);
        break;
    }
  }
}
