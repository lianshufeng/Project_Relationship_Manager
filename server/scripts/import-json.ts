import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import mongoose from 'mongoose';
import {
  EntityRecord, EntitySchema, GraphLayoutRecord, GraphLayoutSchema,
  GraphSettingsRecord, GraphSettingsSchema, MigrationRunRecord, MigrationRunSchema,
  RelationRecord, RelationSchema,
} from '../src/database/schemas.js';

interface LegacyData {
  schemaVersion: string;
  dataRevision: number;
  project: Record<string, unknown> & { id: string; name: string };
  teams: Array<Record<string, unknown> & { id: string; name: string }>;
  positions: Array<Record<string, unknown> & { id: string; name: string }>;
  persons: Array<Record<string, unknown> & { id: string; name: string; positionIds: string[] }>;
  products: Array<Record<string, unknown> & { id: string; name: string }>;
  deviceTypes: Array<Record<string, unknown> & { id: string; name: string }>;
  devices: Array<Record<string, unknown> & { id: string; name: string }>;
  areas: Array<Record<string, unknown> & { id: string; name: string }>;
  relations: Array<Record<string, unknown> & { id: string; sourceId: string; targetId: string; relationType: string }>;
  settings: { layoutDirection: 'LR' | 'TB'; positions: Record<string, { x: number; y: number }>; zoom?: number; viewportX?: number; viewportY?: number };
}

const uri = process.env.MONGODB_URI;
if (!uri) throw new Error('缺少 MONGODB_URI 环境变量');

const sourcePath = path.resolve(process.cwd(), process.env.PROJECT_DATA_JSON || 'store/project-relationship-data.json');
const source = await readFile(sourcePath);
const sourceHash = createHash('sha256').update(source).digest('hex');
const data = JSON.parse(source.toString('utf8')) as LegacyData;
if (data.schemaVersion !== '1.0' || data.dataRevision !== 16) throw new Error('JSON 数据版本不是 1.0/16，已停止迁移');

await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
try {
  const Entity = mongoose.model(EntityRecord.name, EntitySchema);
  const Relation = mongoose.model(RelationRecord.name, RelationSchema);
  const Layout = mongoose.model(GraphLayoutRecord.name, GraphLayoutSchema);
  const Settings = mongoose.model(GraphSettingsRecord.name, GraphSettingsSchema);
  const Migration = mongoose.model(MigrationRunRecord.name, MigrationRunSchema);
  await Promise.all([Entity.init(), Relation.init(), Layout.init(), Settings.init(), Migration.init()]);

  const migrationId = '001-import-project-json';
  const completed = await Migration.findById(migrationId).lean().exec();
  if (completed) {
    if (completed.sourceHash !== sourceHash) throw new Error('迁移已执行，但当前 JSON 哈希不同，拒绝覆盖数据库');
    console.log('迁移已执行且源文件未变化，本次安全跳过。');
    process.exitCode = 0;
  } else {
    const existing = await Entity.countDocuments();
    if (existing) throw new Error(`数据库已有 ${existing} 个实体且没有对应迁移记录，拒绝导入`);

    const projectId = data.project.id;
    const entities = [
      {
        _id: projectId, projectId, entityType: 'project', name: data.project.name,
        shortName: data.project.shortName, address: data.project.address, description: data.project.description,
        icon: data.project.icon, sort: 0, revision: 1,
      },
      ...data.teams.map(item => ({
        _id: item.id, projectId, entityType: 'team', name: item.name, parentId: item.parentId,
        teamType: item.type, icon: item.icon, color: item.color, sort: item.sort ?? 99,
        description: item.description, revision: 1,
      })),
      ...data.positions.map(item => ({
        _id: item.id, projectId, entityType: 'position', name: item.name, teamId: item.teamId,
        icon: item.icon, color: item.color, sort: item.sort ?? 99, description: item.description, revision: 1,
      })),
      ...data.persons.map(item => ({
        _id: item.id, projectId, entityType: 'person', name: item.name, phone: item.phone,
        avatar: item.avatar, icon: item.icon, description: item.description, sort: 99, revision: 1,
      })),
      ...data.products.map(item => ({
        _id: item.id, projectId, entityType: 'product', name: item.name, icon: item.icon,
        color: item.color, description: item.description, sort: 99, revision: 1,
      })),
      ...data.deviceTypes.map(item => ({
        _id: item.id, projectId, entityType: 'deviceType', name: item.name, category: item.category,
        icon: item.icon, color: item.color, description: item.description, sort: 99, revision: 1,
      })),
      ...data.devices.map(item => ({
        _id: item.id, projectId, entityType: 'device', name: item.name, deviceTypeId: item.deviceTypeId,
        code: item.code, description: item.description, sort: 99, revision: 1,
      })),
      ...data.areas.map(item => ({
        _id: item.id, projectId, entityType: 'area', name: item.name, icon: item.icon,
        description: item.description, sort: 99, revision: 1,
      })),
    ];
    const relations = data.relations.map((item, sort) => ({
      _id: item.id, projectId, sourceEntityId: item.sourceId, targetEntityId: item.targetId,
      relationType: item.relationType, label: item.label, sort, revision: 1,
    }));
    const layouts = Object.entries(data.settings.positions).map(([entityId, position]) => ({
      _id: `${projectId}:${entityId}`, projectId, entityId, x: position.x, y: position.y,
    }));

    const entityIds = new Set(entities.map(entity => entity._id));
    if (entityIds.size !== entities.length) throw new Error('迁移源数据存在重复实体 ID');
    const broken = relations.filter(relation => !entityIds.has(relation.sourceEntityId) || !entityIds.has(relation.targetEntityId));
    if (broken.length) throw new Error(`迁移源数据包含 ${broken.length} 条孤立关系`);

    await mongoose.connection.transaction(async session => {
      await Entity.insertMany(entities, { session });
      await Relation.insertMany(relations, { session });
      if (layouts.length) await Layout.insertMany(layouts, { session });
      await Settings.create([{
        _id: projectId, projectId, layoutDirection: data.settings.layoutDirection,
        zoom: data.settings.zoom, viewportX: data.settings.viewportX, viewportY: data.settings.viewportY,
      }], { session });
      await Migration.create([{
        _id: migrationId, sourceHash, entityCount: entities.length,
        relationCount: relations.length, layoutCount: layouts.length, status: 'completed',
      }], { session });
    });

    const [entityCount, relationCount, layoutCount] = await Promise.all([
      Entity.countDocuments({ projectId }), Relation.countDocuments({ projectId }), Layout.countDocuments({ projectId }),
    ]);
    if (entityCount !== entities.length || relationCount !== relations.length || layoutCount !== layouts.length) {
      throw new Error('迁移后回读数量不一致');
    }
    console.log(JSON.stringify({ migrationId, projectId, entityCount, relationCount, layoutCount, sourceHash }, null, 2));
  }
} finally {
  await mongoose.disconnect();
}
