import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException, type OnModuleInit } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { randomUUID } from 'node:crypto';
import type { ClientSession, Connection, Model } from 'mongoose';
import type { ObjectId } from 'mongodb';
import { EntityFeedbackRecord, EntityRecord, FeedbackAttachmentRecord } from '../database/schemas.js';
import { deleteFeedbackImages, feedbackBucketName, openFeedbackImage, uploadFeedbackImage } from '../database/feedback-gridfs.js';
import { normalizeUploadedFileName } from '../database/file-name.js';
import type { CreateFeedbackDto, UpdateFeedbackDto } from './dto.js';

export interface FeedbackImage {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

type PlainFeedback = EntityFeedbackRecord & { createdAt?: Date; updatedAt?: Date };
type PlainAttachment = FeedbackAttachmentRecord & { createdAt?: Date };
type StoredAttachment = Omit<FeedbackAttachmentRecord, 'gridFsFileId'> & { gridFsFileId: ObjectId };

const allowedImageTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);

@Injectable()
export class FeedbackService implements OnModuleInit {
  private readonly logger = new Logger(FeedbackService.name);
  constructor(
    @InjectModel(EntityRecord.name) private readonly entities: Model<EntityRecord>,
    @InjectModel(EntityFeedbackRecord.name) private readonly feedbacks: Model<EntityFeedbackRecord>,
    @InjectModel(FeedbackAttachmentRecord.name) private readonly attachments: Model<FeedbackAttachmentRecord>,
    @InjectConnection() private readonly connection: Connection,
  ) {}

  async onModuleInit() {
    const db = this.database();
    const gridFiles = db.collection(`${feedbackBucketName}.files`);
    const gridChunks = db.collection(`${feedbackBucketName}.chunks`);
    await Promise.all([
      gridChunks.createIndex({ files_id: 1, n: 1 }, { unique: true }),
      gridFiles.createIndex({ filename: 1, uploadDate: 1 }),
      gridFiles.createIndex({ 'metadata.projectId': 1, 'metadata.feedbackId': 1 }),
      gridFiles.createIndex({ 'metadata.attachmentId': 1 }, { unique: true, partialFilterExpression: { 'metadata.attachmentId': { $type: 'string' } } }),
    ]);
    const referencedIds = new Set((await this.attachments.distinct('gridFsFileId')).map(String));
    const orphanIds: ObjectId[] = [];
    for await (const file of gridFiles.find({}, { projection: { _id: 1 } })) {
      const fileId = file._id as ObjectId;
      if (!referencedIds.has(String(fileId))) orphanIds.push(fileId);
    }
    await deleteFeedbackImages(db, orphanIds);
    if (orphanIds.length) this.logger.log(`已清理 ${orphanIds.length} 个孤立的反馈图片文件`);
  }

  async list(projectId: string, entityId: string, page: number, pageSize: number) {
    await this.ensureEntity(projectId, entityId);
    if (!Number.isInteger(page) || page < 1 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 20) {
      throw new BadRequestException('分页参数无效，页码至少为 1，每页最多 20 条');
    }
    const filter = { projectId, entityId, kind: 'feedback' as const };
    const [rows, total] = await Promise.all([
      this.feedbacks.find(filter).sort({ createdAt: -1, _id: -1 }).skip((page - 1) * pageSize).limit(pageSize).lean().exec(),
      this.feedbacks.countDocuments(filter),
    ]);
    const roots = rows as PlainFeedback[];
    const rootIds = roots.map(row => row._id);
    const handlingRows = rootIds.length
      ? await this.feedbacks.find({ projectId, entityId, kind: 'handling', rootFeedbackId: { $in: rootIds } }).sort({ createdAt: 1, _id: 1 }).lean().exec() as PlainFeedback[]
      : [];
    const recordIds = [...rootIds, ...handlingRows.map(row => row._id)];
    const attachmentRows = recordIds.length
      ? await this.attachments.find({ projectId, entityId, feedbackId: { $in: recordIds } }).sort({ createdAt: 1 }).lean().exec() as PlainAttachment[]
      : [];
    const attachmentsByRecord = new Map<string, PlainAttachment[]>();
    for (const attachment of attachmentRows) {
      attachmentsByRecord.set(attachment.feedbackId, [...(attachmentsByRecord.get(attachment.feedbackId) || []), attachment]);
    }
    const handlingByRoot = new Map<string, PlainFeedback[]>();
    for (const handling of handlingRows) {
      handlingByRoot.set(handling.rootFeedbackId!, [...(handlingByRoot.get(handling.rootFeedbackId!) || []), handling]);
    }
    return {
      items: roots.map(root => {
        const handlingRecords = (handlingByRoot.get(root._id) || []).map(record => this.toRecord(record, attachmentsByRecord.get(record._id) || []));
        return { ...this.toRecord(root, attachmentsByRecord.get(root._id) || []), status: handlingRecords.length ? 'resolved' : 'pending', handlingRecords };
      }),
      total,
      page,
      pageSize,
    };
  }

  async create(projectId: string, entityId: string, dto: CreateFeedbackDto, images: FeedbackImage[]) {
    await this.ensureEntity(projectId, entityId);
    this.validateContent(dto.content, images);
    const recordId = `feedback-${randomUUID()}`;
    const stored = await this.storeImages(projectId, entityId, recordId, images);
    try {
      await this.connection.transaction(async session => {
        await this.feedbacks.create([{
          _id: recordId, projectId, entityId, kind: 'feedback', content: dto.content?.trim(),
          authorName: dto.authorName?.trim() || '', status: 'pending', revision: 1,
        }], { session });
        await this.insertAttachmentMetadata(stored, session);
      });
    } catch (error) {
      await this.cleanupGridFs(stored.map(item => item.gridFsFileId));
      throw error;
    }
    return this.getRecord(projectId, entityId, recordId);
  }

  async createHandling(projectId: string, entityId: string, feedbackId: string, dto: CreateFeedbackDto, images: FeedbackImage[]) {
    await this.ensureRoot(projectId, entityId, feedbackId);
    this.validateContent(dto.content, images);
    const recordId = `handling-${randomUUID()}`;
    const stored = await this.storeImages(projectId, entityId, recordId, images);
    try {
      await this.connection.transaction(async session => {
        await this.feedbacks.create([{
          _id: recordId, projectId, entityId, kind: 'handling', rootFeedbackId: feedbackId,
          content: dto.content?.trim(), authorName: dto.authorName?.trim() || '', revision: 1,
        }], { session });
        await this.insertAttachmentMetadata(stored, session);
        const rootUpdate = await this.feedbacks.updateOne(
          { _id: feedbackId, projectId, entityId, kind: 'feedback' },
          { $set: { status: 'resolved' }, $inc: { revision: 1 } },
          { session },
        );
        if (!rootUpdate.matchedCount) throw new NotFoundException('所属反馈不存在');
      });
    } catch (error) {
      await this.cleanupGridFs(stored.map(item => item.gridFsFileId));
      throw error;
    }
    return this.getRecord(projectId, entityId, recordId);
  }

  async update(projectId: string, entityId: string, recordId: string, dto: UpdateFeedbackDto, images: FeedbackImage[]) {
    this.validateImages(images);
    const removeIds = this.parseRemoveIds(dto.removeAttachmentIds);
    const current = await this.feedbacks.findOne({ _id: recordId, projectId, entityId }).lean().exec() as PlainFeedback | null;
    if (!current) throw new NotFoundException('反馈记录不存在');
    if (current.revision !== dto.revision) throw new ConflictException('该记录已被其他操作更新，请刷新后重试');
    const existing = await this.attachments.find({ projectId, entityId, feedbackId: recordId }).lean().exec() as PlainAttachment[];
    if (removeIds.some(id => !existing.some(item => item._id === id))) throw new BadRequestException('包含无效的待删除图片');
    const remainingImageCount = existing.length - removeIds.length + images.length;
    this.validateContent(dto.content, remainingImageCount);
    if (remainingImageCount > 20) throw new BadRequestException('每条记录最多保留 20 张图片');
    const stored = await this.storeImages(projectId, entityId, recordId, images);
    const removedFileIds = existing.filter(item => removeIds.includes(item._id)).map(item => item.gridFsFileId);
    try {
      await this.connection.transaction(async session => {
        const result = await this.feedbacks.updateOne(
          { _id: recordId, projectId, entityId, revision: dto.revision },
          { $set: { content: dto.content?.trim(), authorName: dto.authorName?.trim() || '' }, $inc: { revision: 1 } },
          { runValidators: true, session },
        );
        if (!result.matchedCount) throw new ConflictException('该记录已被其他操作更新，请刷新后重试');
        if (removeIds.length) await this.attachments.deleteMany({ projectId, entityId, feedbackId: recordId, _id: { $in: removeIds } }).session(session);
        await this.insertAttachmentMetadata(stored, session);
      });
    } catch (error) {
      await this.cleanupGridFs(stored.map(item => item.gridFsFileId));
      throw error;
    }
    await this.cleanupGridFs(removedFileIds);
    return this.getRecord(projectId, entityId, recordId);
  }

  async delete(projectId: string, entityId: string, recordId: string) {
    let deletedCount = 0;
    let deletedFileIds: ObjectId[] = [];
    await this.connection.transaction(async session => {
      const current = await this.feedbacks.findOne({ _id: recordId, projectId, entityId }).session(session).lean().exec() as PlainFeedback | null;
      if (!current) throw new NotFoundException('反馈记录不存在');
      const recordIds = current.kind === 'feedback'
        ? (await this.feedbacks.find({ projectId, entityId, $or: [{ _id: recordId }, { rootFeedbackId: recordId }] }).session(session).select({ _id: 1 }).lean().exec()).map(item => item._id)
        : [recordId];
      deletedFileIds = (await this.attachments.find({ projectId, entityId, feedbackId: { $in: recordIds } }).session(session).select({ gridFsFileId: 1 }).lean().exec()).map(item => item.gridFsFileId);
      await this.attachments.deleteMany({ projectId, entityId, feedbackId: { $in: recordIds } }).session(session);
      deletedCount = (await this.feedbacks.deleteMany({ projectId, entityId, _id: { $in: recordIds } }).session(session)).deletedCount;
      if (current.kind === 'handling' && current.rootFeedbackId) {
        const remaining = await this.feedbacks.countDocuments({ projectId, entityId, kind: 'handling', rootFeedbackId: current.rootFeedbackId }).session(session);
        await this.feedbacks.updateOne(
          { _id: current.rootFeedbackId, projectId, entityId, kind: 'feedback' },
          { $set: { status: remaining ? 'resolved' : 'pending' }, $inc: { revision: 1 } },
          { session },
        );
      }
    });
    await this.cleanupGridFs(deletedFileIds);
    return { message: '反馈记录已删除', deletedCount };
  }

  async getAttachment(projectId: string, entityId: string, attachmentId: string) {
    const attachment = await this.attachments.findOne({ _id: attachmentId, projectId, entityId }).lean().exec();
    if (!attachment) throw new NotFoundException('反馈图片不存在');
    const record = await this.feedbacks.exists({ _id: attachment.feedbackId, projectId, entityId });
    if (!record) throw new NotFoundException('反馈图片不存在');
    return { ...attachment, stream: openFeedbackImage(this.database(), attachment.gridFsFileId) };
  }

  private async getRecord(projectId: string, entityId: string, recordId: string) {
    const record = await this.feedbacks.findOne({ _id: recordId, projectId, entityId }).lean().exec() as PlainFeedback | null;
    if (!record) throw new NotFoundException('反馈记录不存在');
    const attachments = await this.attachments.find({ projectId, entityId, feedbackId: recordId }).sort({ createdAt: 1 }).lean().exec() as PlainAttachment[];
    return this.toRecord(record, attachments);
  }

  private toRecord(record: PlainFeedback, attachments: PlainAttachment[]) {
    return {
      id: record._id,
      kind: record.kind,
      content: record.content,
      authorName: record.authorName,
      status: record.status,
      revision: record.revision,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      attachments: attachments.map(item => ({
        id: item._id,
        fileName: item.fileName,
        mimeType: item.mimeType,
        size: item.size,
        url: `/api/v1/projects/${encodeURIComponent(record.projectId)}/entities/${encodeURIComponent(record.entityId)}/feedbacks/attachments/${encodeURIComponent(item._id)}`,
      })),
    };
  }

  private async storeImages(projectId: string, entityId: string, feedbackId: string, images: FeedbackImage[]) {
    this.validateImages(images);
    const stored: StoredAttachment[] = [];
    try {
      for (const image of images) {
        const attachmentId = `feedback-image-${randomUUID()}`;
        const fileName = normalizeUploadedFileName(image.originalname);
        if (!fileName || fileName.length > 255) throw new BadRequestException('图片文件名无效或超过 255 个字符');
        const gridFsFileId = await uploadFeedbackImage(this.database(), fileName, image.buffer, {
          projectId, entityId, feedbackId, attachmentId, mimeType: image.mimetype, size: image.size,
        });
        stored.push({ _id: attachmentId, projectId, entityId, feedbackId, gridFsFileId, fileName, mimeType: image.mimetype, size: image.size });
      }
      return stored;
    } catch (error) {
      await this.cleanupGridFs(stored.map(item => item.gridFsFileId));
      throw error;
    }
  }

  private async insertAttachmentMetadata(stored: StoredAttachment[], session: ClientSession) {
    if (stored.length) await this.attachments.insertMany(stored, { session });
  }

  private async cleanupGridFs(fileIds: ObjectId[]) {
    if (!fileIds.length) return;
    try {
      await deleteFeedbackImages(this.database(), fileIds);
    } catch (error) {
      this.logger.warn(`GridFS 图片清理失败，将在服务下次启动时重试孤立文件清理：${(error as Error).message}`);
    }
  }

  private database() {
    if (!this.connection.db) throw new Error('MongoDB 尚未连接');
    return this.connection.db;
  }

  private validateContent(content: string | undefined, images: FeedbackImage[] | number) {
    const imageCount = typeof images === 'number' ? images : images.length;
    if (!content?.trim() && !imageCount) throw new BadRequestException('反馈内容和图片至少填写一项');
    if (typeof images !== 'number') this.validateImages(images);
  }

  private validateImages(images: FeedbackImage[]) {
    if (images.length > 20) throw new BadRequestException('每条记录最多上传 20 张图片');
    for (const image of images) {
      if (!allowedImageTypes.has(image.mimetype)) throw new BadRequestException('图片仅支持 JPG、PNG 和 WebP 格式');
      if (!image.size || image.size > 10 * 1024 * 1024) throw new BadRequestException('单张图片不能超过 10 MB');
    }
  }

  private parseRemoveIds(value?: string) {
    if (!value) return [];
    try {
      const ids = JSON.parse(value) as unknown;
      if (!Array.isArray(ids) || ids.some(id => typeof id !== 'string') || ids.length !== new Set(ids).size) throw new Error();
      return ids as string[];
    } catch {
      throw new BadRequestException('待删除图片参数无效');
    }
  }

  private async ensureRoot(projectId: string, entityId: string, feedbackId: string) {
    const record = await this.feedbacks.exists({ _id: feedbackId, projectId, entityId, kind: 'feedback' });
    if (!record) throw new NotFoundException('所属反馈不存在');
  }

  private async ensureEntity(projectId: string, entityId: string) {
    const entity = await this.entities.exists({ _id: entityId, projectId });
    if (!entity) throw new NotFoundException('实体不存在');
  }
}
