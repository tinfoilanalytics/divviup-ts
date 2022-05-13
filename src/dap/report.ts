import { TaskId } from "dap/taskId";
import { Encodable, encodeArray } from "dap/encoding";
import { Nonce } from "dap/nonce";
import { Extension } from "dap/extension";
import { HpkeCiphertext } from "dap/ciphertext";

export class Report implements Encodable {
  constructor(
    public taskID: TaskId,
    public nonce: Nonce,
    public extensions: Extension[],
    public encryptedInputShares: HpkeCiphertext[]
  ) {}

  encode(): Buffer {
    return Buffer.concat([
      this.taskID.encode(),
      this.nonce.encode(),
      encodeArray(this.extensions),
      encodeArray(this.encryptedInputShares),
    ]);
  }
}
