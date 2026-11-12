/**
 * Common contract for marketplace integrations (docs/ARCHITECTURE.md →
 * Entegrasyonlar). Each marketplace (Trendyol in Release A, INT-TY-01) is an
 * adapter. Adapters receive decrypted credentials only for the duration of a
 * call and must never log or return them.
 */

export interface CredentialField {
  /** Key in the stored credential object. */
  key: string;
  /** Turkish label for the UI. */
  label: string;
  /** Secret fields are write-only; other fields are shown masked as well. */
  secret: boolean;
  maxLength: number;
  pattern?: RegExp;
}

export interface ChannelDefinition {
  code: string;
  name: string;
  credentialFields: readonly CredentialField[];
}

export type ConnectionResult =
  | { ok: true }
  | {
      ok: false;
      code: 'INVALID_CREDENTIALS' | 'FORBIDDEN' | 'UNAVAILABLE' | 'UNKNOWN';
    };

export interface ChannelAdapter {
  readonly definition: ChannelDefinition;
  /** Read-only check that the credentials are accepted by the marketplace. */
  testConnection(
    credentials: Readonly<Record<string, string>>,
  ): Promise<ConnectionResult>;
}

/** Marketplaces whose accounts can be stored. Adapters are added per channel. */
export const CHANNEL_DEFINITIONS: readonly ChannelDefinition[] = [
  {
    code: 'trendyol',
    name: 'Trendyol',
    credentialFields: [
      {
        key: 'supplierId',
        label: 'Satıcı ID',
        secret: false,
        maxLength: 20,
        pattern: /^\d{1,20}$/,
      },
      { key: 'apiKey', label: 'API Key', secret: true, maxLength: 200 },
      { key: 'apiSecret', label: 'API Secret', secret: true, maxLength: 200 },
    ],
  },
];

export function channelDefinition(code: string): ChannelDefinition | undefined {
  return CHANNEL_DEFINITIONS.find((d) => d.code === code);
}
