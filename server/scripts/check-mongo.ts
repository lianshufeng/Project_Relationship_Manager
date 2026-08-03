import mongoose from 'mongoose';

const uri = process.env.MONGODB_URI;
if (!uri) throw new Error('缺少 MONGODB_URI 环境变量');

try {
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
  const hello = await mongoose.connection.db!.admin().command({ hello: 1 });
  console.log(JSON.stringify({
    database: mongoose.connection.name,
    replicaSet: hello.setName || null,
    writable: Boolean(hello.isWritablePrimary),
    members: Array.isArray(hello.hosts) ? hello.hosts.length : 0,
  }, null, 2));
} finally {
  await mongoose.disconnect();
}
