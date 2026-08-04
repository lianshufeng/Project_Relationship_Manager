import mongoose from 'mongoose';
import { PersonActivityRecord, PersonActivitySchema } from '../src/database/schemas.js';

const uri = process.env.MONGODB_URI;
if (!uri) throw new Error('缺少 MONGODB_URI 环境变量');

await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
try {
  const PersonActivity = mongoose.model(PersonActivityRecord.name, PersonActivitySchema);
  await PersonActivity.init();
  const rows = await PersonActivity.find().select({ projectId: 1, personId: 1, activityDate: 1, sourceType: 1, sourceId: 1, activityValue: 1 }).lean().exec();
  const keys = new Set<string>();
  for (const row of rows) {
    const key = `${row.projectId}:${row.personId}:${row.activityDate}:${row.sourceType}:${row.sourceId}`;
    if (keys.has(key) || !Number.isSafeInteger(row.activityValue) || row.activityValue <= 0) throw new Error('人员活跃度集合包含重复或无效记录');
    keys.add(key);
  }
  console.log(JSON.stringify({ migrationId: '004-create-person-activity-records', recordCount: rows.length, duplicateCount: 0, invalidCount: 0 }, null, 2));
} finally {
  await mongoose.disconnect();
}
