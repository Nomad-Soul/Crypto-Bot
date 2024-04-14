export default class TraderDeal {
  id;
  buyOrders = [];
  sellOrder = [];

  constructor(data) {
    this.id = data.id;
    data.buyOrders.forEach((txid) => this.buyOrders.push(txid));
  }
}
