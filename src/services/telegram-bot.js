import TelegramBot from 'node-telegram-bot-api';

export default class TelegramCryptoBot {
  // replace the value below with the Telegram token you receive from @BotFather
  #ownerId = 0;
  /** @type {TelegramBot} */
  #telegramBot;

  /**
   * @callback listener
   * @param {string[]} messageArguments
   * @returns {string}
   */
  #onMessage;

  /**@type {TelegramCryptoBot} */
  static Instance;

  /**
   * @param {{ privateKey: string; chatId: number; }} settings
   */
  constructor(settings) {
    this.#telegramBot = new TelegramBot(settings.privateKey, { polling: true });
    this.#ownerId = settings.chatId;

    TelegramCryptoBot.Instance = this;
  }

  onMessage(callback) {
    this.#telegramBot.on('message', callback);
  }

  /**
   * @param {{ chat: { id: any; }; text: any; }} message
   */
  async respond(message) {
    const chatId = message.chat.id;
    const messageText = message.text.split(' ');

    const command = messageText[0];

    switch (command) {
      case 'chatId':
        return this.sendMessage(chatId, `Your id is: ${chatId}`);
      default:
        return this.sendMessage(chatId, `Command ${command} not recognised`);
    }
  }

  /**
   * @param {TelegramBot.ChatId} chatId
   * @param {string} message
   */
  async sendMessage(chatId, message) {
    // checks if empty or undefined string;
    message = message ? message : 'Invalid operation';
    return this.#telegramBot.sendMessage(chatId, message);
  }

  /**
   * @param {string} message
   */
  async log(message) {
    if (typeof this.#ownerId !== 'undefined' && this.#ownerId > 0) return this.sendMessage(this.#ownerId, message);
  }

  // async handleMessages(message) {
  //   var commandArguments = message.text.toLowerCase().split(' ');
  //   const command = commandArguments[0];
  //   const parameter = commandArguments[1];
  //   switch (command) {
  //     case 'status': {
  //       if (!this.hasBot(parameter)) return this.telegramBot.log(`Bot ${parameter} not found`);
  //       let botSettings = this.getBotSettings(parameter);
  //       return this.telegramBot.log(botSettings.strategy?.lastResult?.status || 'none');
  //     }

  //     case 'next': {
  //       let reports = this.getPlannedOrders('all')
  //         .filter((o) => o.isScheduledForToday && !o.isClosed && Utils.toShortDate(o.openDate) === Utils.toShortDate(new Date(Date.now())))
  //         .sort((a, b) => a.openDate.getTime() - b.openDate.getTime())
  //         .map((o) => o.toString());

  //       if (reports.length > 0) return this.telegramBot.log(reports.join('\n'));
  //       else return this.telegramBot.log('No orders planned for today');
  //     }

  //     default:
  //       return this.telegramBot.respond(message);
  //   }
  // }
}
