import mongoose from 'mongoose';

const uri = process.env.MONGODB_URI;
if (!uri) throw new Error('缺少 MONGODB_URI 环境变量');

await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
try {
  const entities = mongoose.connection.db!.collection('entities');
  const target = { entityType: { $in: ['product', 'device'] } };
  const beforeRows = await entities.find(target, { projection: { activityLevel: 1 } }).toArray();
  if (beforeRows.some(item => !Number.isFinite(item.activityLevel) || item.activityLevel < 0 || item.activityLevel > 100)) {
    throw new Error('数据库包含超出 0 到 100 范围的使用状态评估值，已停止迁移');
  }
  const updates = beforeRows
    .map(item => ({ _id: item._id, current: Number(item.activityLevel), normalized: Math.round(Number(item.activityLevel) / 10) * 10 }))
    .filter(item => item.current !== item.normalized);

  if (updates.length) {
    await mongoose.connection.transaction(async session => {
      await entities.bulkWrite(updates.map(item => ({
        updateOne: { filter: { _id: item._id, activityLevel: item.current }, update: { $set: { activityLevel: item.normalized } } },
      })), { session });
    });
  }

  const afterRows = await entities.find(target, { projection: { activityLevel: 1 } }).toArray();
  const invalidCount = afterRows.filter(item => !Number.isInteger(item.activityLevel) || item.activityLevel < 0 || item.activityLevel > 100 || item.activityLevel % 10 !== 0).length;
  if (afterRows.length !== beforeRows.length || invalidCount) throw new Error(`迁移校验失败：迁移前 ${beforeRows.length}，迁移后 ${afterRows.length}，无效 ${invalidCount}`);
  console.log(JSON.stringify({ migrationId: '003-normalize-activity-level-step', entityCount: afterRows.length, normalizedCount: updates.length, invalidCount }, null, 2));
} finally {
  await mongoose.disconnect();
}
