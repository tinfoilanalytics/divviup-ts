import { Encodable } from "dap/encoding";

export class HpkeCiphertext implements Encodable {
  constructor(
    public configId: number,
    public encapsulatedContext: Buffer,
    public payload: Buffer
  ) {
    if (configId > 255) {
      throw new Error("configId must be a uint8 (< 256)");
    }
  }

  encode(): Buffer {
    return Buffer.concat([
      Buffer.from([this.configId]),
      this.encapsulatedContext,
      this.payload,
    ]);
  }
}
