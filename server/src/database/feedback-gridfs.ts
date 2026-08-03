import { GridFSBucket, ObjectId, type Db, type GridFSBucketReadStream } from 'mongodb';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

export const feedbackBucketName = 'feedback_images';

export interface FeedbackFileMetadata {
  projectId: string;
  entityId: string;
  feedbackId: string;
  attachmentId: string;
  mimeType: string;
  size: number;
}

export function feedbackBucket(db: Db) {
  return new GridFSBucket(db, { bucketName: feedbackBucketName, chunkSizeBytes: 255 * 1024 });
}

export async function uploadFeedbackImage(db: Db, fileName: string, data: Buffer, metadata: FeedbackFileMetadata, fileId = new ObjectId()) {
  const upload = feedbackBucket(db).openUploadStreamWithId(fileId, fileName, { metadata });
  await pipeline(Readable.from(data), upload);
  return fileId;
}

export function openFeedbackImage(db: Db, fileId: ObjectId): GridFSBucketReadStream {
  return feedbackBucket(db).openDownloadStream(fileId);
}

export async function readFeedbackImage(db: Db, fileId: ObjectId) {
  const chunks: Buffer[] = [];
  for await (const chunk of openFeedbackImage(db, fileId)) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

export async function deleteFeedbackImages(db: Db, fileIds: ObjectId[]) {
  const bucket = feedbackBucket(db);
  for (const fileId of fileIds) {
    try {
      await bucket.delete(fileId);
    } catch (error) {
      if (!String((error as Error).message).includes('FileNotFound')) throw error;
    }
  }
}
