// Marks values that came out of decryption. The brand keeps decrypted data
// from flowing into sinks by accident; rendering goes through React text nodes
// or react-markdown (no raw HTML), never dangerouslySetInnerHTML.
declare const decryptedBrand: unique symbol;
export type Decrypted<T> = T & { readonly [decryptedBrand]: true };

export function markDecrypted<T>(v: T): Decrypted<T> {
  return v as Decrypted<T>;
}
