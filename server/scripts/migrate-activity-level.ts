import mongoose from 'mongoose';

const uri = process.env.MONGODB_URI;
if (!uri) throw new Error('缺少 MONGODB_URI 环境变量');

await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
try {
  const entities = mongoose.connection.db!.collection('entities');
  const target = { entityType: { $in: ['product', 'device'] } };
  const beforeCount = await entities.countDocuments(target);

  await mongoose.connection.transaction(async session => {
    await entities.updateMany(
      { ...target, activityLevel: { $exists: false } },
      { $set: { activityLevel: 0 } },
      { session },
    );
  });

  const [afterCount, missingCount, activityRows, unsupportedCount] = await Promise.all([
    entities.countDocuments(target),
    entities.countDocuments({ ...target, activityLevel: { $exists: false } }),
    entities.find(target, { projection: { activityLevel: 1 } }).toArray(),
    entities.countDocuments({ entityType: { $nin: ['product', 'device'] }, activityLevel: { $exists: true } }),
  ]);
  const invalidCount = activityRows.filter(item => !Number.isInteger(item.activityLevel) || item.activityLevel < 0 || item.activityLevel > 100).length;
  if (beforeCount !== afterCount || missingCount || invalidCount || unsupportedCount) {
    throw new Error(`迁移校验失败：迁移前 ${beforeCount}，迁移后 ${afterCount}，缺失 ${missingCount}，无效 ${invalidCount}，越界实体 ${unsupportedCount}`);
  }
  console.log(JSON.stringify({ migrationId: '002-backfill-activity-level', entityCount: afterCount, missingCount, invalidCount, unsupportedCount }, null, 2));
} finally {
  await mongoose.disconnect();
}
