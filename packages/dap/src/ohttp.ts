import { Buffer } from "buffer";
import { Client as OhttpClient, ClientConstructor } from "oblivious-http";
import { DAPError } from "./errors.js";
import { BHttpEncoder, BHttpDecoder } from "@dajiaji/bhttp";

// OHTTP Media Types as constants
export const OHTTP_MEDIA_TYPES = {
  KEYS: "application/ohttp-keys",
  REQUEST: "message/ohttp-req",
  RESPONSE: "message/ohttp-res"
} as const;

// Retry configuration
const RETRY_CONFIG = {
  MAX_ATTEMPTS: 3,
  BACKOFF_MS: 1000, // Base delay for exponential backoff
  MAX_BACKOFF_MS: 10000 // Maximum delay between retries
} as const;

export interface OhttpConfig {
  keyConfigs?: URL | string;
  keyConfigData?: Uint8Array;
  relay: URL | string;
  /**
   * Optional custom retry configuration
   */
  retryConfig?: {
    maxAttempts?: number;
    backoffMs?: number;
    maxBackoffMs?: number;
  };
}

export class DapOhttpClient {
  private ohttpClient?: OhttpClient;
  private readonly clientConstructor: ClientConstructor;
  private readonly encoder: BHttpEncoder;
  private readonly decoder: BHttpDecoder;
  private readonly relay: URL;
  private readonly keyConfigs?: URL;
  private readonly retryConfig: typeof RETRY_CONFIG;
  private initializationPromise?: Promise<void>;
  private lastKeyConfigUpdate: number = 0;
  private static readonly KEY_CONFIG_MIN_REFRESH_INTERVAL_MS = 60000; // 1 minute

  constructor(private config: OhttpConfig) {
    this.clientConstructor = new ClientConstructor();
    this.encoder = new BHttpEncoder();
    this.decoder = new BHttpDecoder();
    this.relay = typeof config.relay === 'string' ? new URL(config.relay) : config.relay;

    if (config.keyConfigs) {
      this.keyConfigs = typeof config.keyConfigs === 'string' ? new URL(config.keyConfigs) : config.keyConfigs;
    }

    this.retryConfig = {
      ...RETRY_CONFIG,
      ...config.retryConfig
    };

    if (config.keyConfigData) {
      this.initializationPromise = this.initializeWithKeyConfig(config.keyConfigData)
        .catch(error => {
          this.initializationPromise = undefined;
          throw error;
        });
    }
  }

  private async initializeWithKeyConfig(keyConfigData: Uint8Array): Promise<void> {
    if (!keyConfigData?.length) {
      throw new Error("Invalid key config data: empty or undefined");
    }

    try {
      this.ohttpClient = await this.clientConstructor.clientForConfig(keyConfigData);
      this.lastKeyConfigUpdate = Date.now();
    } catch (error) {
      throw new Error(`OHTTP client initialization failed: ${error}`);
    }
  }

  private async fetchKeyConfigsWithRetry(): Promise<Uint8Array> {
    if (!this.keyConfigs) {
      throw new Error("No keyConfigs URL provided");
    }

    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= this.retryConfig.MAX_ATTEMPTS; attempt++) {
      try {
        const response = await fetch(this.keyConfigs.toString(), {
          headers: { Accept: OHTTP_MEDIA_TYPES.KEYS }
        });

        if (!response.ok) {
          throw await DAPError.fromResponse(response, "Failed to fetch OHTTP key configs");
        }

        const contentType = response.headers.get("Content-Type");
        if (contentType !== OHTTP_MEDIA_TYPES.KEYS) {
          throw new Error(`Unexpected content type for OHTTP keys: ${contentType}`);
        }

        return new Uint8Array(await response.arrayBuffer());
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        if (attempt < this.retryConfig.MAX_ATTEMPTS) {
          const backoffTime = Math.min(
            this.retryConfig.BACKOFF_MS * Math.pow(2, attempt - 1),
            this.retryConfig.MAX_BACKOFF_MS
          );
          await new Promise(resolve => setTimeout(resolve, backoffTime));
        }
      }
    }

    throw new Error(`Failed to fetch key configs after ${this.retryConfig.MAX_ATTEMPTS} attempts: ${lastError?.message}`);
  }

  async updateKeyConfig(keyConfigData: Uint8Array): Promise<void> {
    await this.initializeWithKeyConfig(keyConfigData);
  }

  async refreshKeyConfig(): Promise<void> {
    if (!this.keyConfigs) {
      throw new Error("Cannot refresh key config without keyConfigs URL");
    }

    // Prevent too frequent refreshes
    const timeSinceLastUpdate = Date.now() - this.lastKeyConfigUpdate;
    if (timeSinceLastUpdate < DapOhttpClient.KEY_CONFIG_MIN_REFRESH_INTERVAL_MS) {
      return;
    }

    const keyConfigData = await this.fetchKeyConfigsWithRetry();
    await this.initializeWithKeyConfig(keyConfigData);
  }

  private async ensureClientWithRetry(): Promise<OhttpClient> {
    if (this.initializationPromise) {
      await this.initializationPromise;
    }

    if (!this.ohttpClient) {
      if (this.config.keyConfigData) {
        await this.initializeWithKeyConfig(this.config.keyConfigData);
      } else {
        const keyConfigData = await this.fetchKeyConfigsWithRetry();
        await this.initializeWithKeyConfig(keyConfigData);
      }
    }

    if (!this.ohttpClient) {
      throw new Error("Failed to initialize OHTTP client");
    }

    return this.ohttpClient;
  }

  async relayRequest(
    method: string,
    url: URL | string,
    headers: Map<string, string>,
    body: Buffer
  ): Promise<Response> {
    const requestUrl = typeof url === 'string' ? new URL(url) : url;
    const originalRequest = new Request(requestUrl.toString(), {
      method,
      headers: Object.fromEntries(headers),
      body,
    });

    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= this.retryConfig.MAX_ATTEMPTS; attempt++) {
      try {
        const client = await this.ensureClientWithRetry();

        // Encode and encapsulate request
        const encodedRequest = await this.encoder.encodeRequest(originalRequest);
        const clientRequestContext = await client.encapsulate(encodedRequest);
        const encapsulatedRequest = clientRequestContext.request.encode();

        // Send request to relay
        const relayResponse = await fetch(this.relay.toString(), {
          method: 'POST',
          headers: {
            'Content-Type': OHTTP_MEDIA_TYPES.REQUEST,
          },
          body: encapsulatedRequest,
        });

        if (!relayResponse.ok) {
          throw await DAPError.fromResponse(relayResponse, 'OHTTP relay request failed');
        }

        // Verify response content type
        const responseContentType = relayResponse.headers.get('Content-Type');
        if (responseContentType !== OHTTP_MEDIA_TYPES.RESPONSE) {
          throw new Error(`Unexpected content type for OHTTP response: ${responseContentType}`);
        }

        // Decapsulate and decode response
        const encapsulatedResponse = new Uint8Array(await relayResponse.arrayBuffer());
        const decodedResponse = await clientRequestContext.decodeAndDecapsulate(encapsulatedResponse);
        return this.decoder.decodeResponse(decodedResponse);

      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        // Handle specific error cases
        if (error instanceof DAPError && error.type === "urn:ietf:params:ppm:dap:error:outdatedConfig") {
          await this.refreshKeyConfig();
          continue;
        }

        if (attempt < this.retryConfig.MAX_ATTEMPTS) {
          const backoffTime = Math.min(
            this.retryConfig.BACKOFF_MS * Math.pow(2, attempt - 1),
            this.retryConfig.MAX_BACKOFF_MS
          );
          await new Promise(resolve => setTimeout(resolve, backoffTime));
        }
      }
    }

    throw new Error(`Request failed after ${this.retryConfig.MAX_ATTEMPTS} attempts: ${lastError?.message}`);
  }
}