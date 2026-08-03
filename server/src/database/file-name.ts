export function normalizeUploadedFileName(fileName: string) {
  const latin1Bytes = Buffer.from(fileName, 'latin1');
  const decoded = latin1Bytes.toString('utf8');
  const isUtf8MisdecodedAsLatin1 = !decoded.includes('\uFFFD') && Buffer.from(decoded, 'utf8').equals(latin1Bytes);
  return (isUtf8MisdecodedAsLatin1 ? decoded : fileName).normalize('NFC');
}
