export default class Queue {
  items = new Map();
  headIndex = 0;
  tailIndex = 0;

  /**
   * @returns {Number}
   */
  get length() {
    return this.items.size;
  }

  /**
   *
   * @param {any} item
   * @returns {any}
   */
  enqueue(item) {
    const itemIndex = this.tailIndex++;
    this.tailIndex >= Number.MAX_SAFE_INTEGER && (this.tailIndex = 0);

    this.items.set(itemIndex, item);

    return item;
  }

  dequeue() {
    if (this.items.size) {
      const itemIndex = this.headIndex++;
      this.headIndex >= Number.MAX_SAFE_INTEGER && (this.headIndex = 0);

      const result = this.items.get(itemIndex);
      this.items.delete(itemIndex);

      return result;
    }
  }

  peek() {
    return this.items.size ? this.items.get(this.headIndex) : undefined;
  }
}
