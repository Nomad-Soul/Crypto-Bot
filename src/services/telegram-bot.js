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
    return this.#telegramBot.sendMessage(chatId, message);
  }

  /**
   * @param {string} message
   */
  log(message) {
    if (typeof this.#ownerId !== 'undefined' && this.#ownerId > 0) return this.sendMessage(this.#ownerId, message);
  }
}
