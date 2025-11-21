export interface E2EEEncryptedStringV1 {
  /** 固定前缀用于识别密文格式 */
  prefix: 'E2EE.v1';
  /** Base64 编码的 12 字节 IV */
  iv: string;
  /** Base64 编码的密文 */
  ciphertext: string;
}

export type E2EEContentString = string; // 采用可读字符串承载密文（含前缀）

export interface E2EEKeyRecord {
  converseId: string;
  /** Base64 编码的原始 32 字节密钥 */
  keyB64: string;
}


