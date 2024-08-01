import { NextRequest, NextResponse } from 'next/server';
import { Storage, Bucket } from '@google-cloud/storage';
import crypto from 'crypto';

const bucketName = process.env.GOOGLE_BUCKET_NAME;
const serviceAccountJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;

if (!serviceAccountJson) {
  throw new Error('Environment variable GOOGLE_SERVICE_ACCOUNT_JSON is not defined');
}

console.log(serviceAccountJson, "SERVICE ACCOUNT JSON FROM ENV");

const serviceAccount = JSON.parse(serviceAccountJson);

const storage = new Storage({
  projectId: serviceAccount.project_id,
  credentials: {
    client_email: serviceAccount.client_email,
    private_key: serviceAccount.private_key,
  },
});

async function generateVideoHash(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const reader = file.stream().getReader();

    const pump = async () => {
      const { done, value } = await reader.read();
      if (done) {
        hash.end();
        resolve(hash.digest('hex'));
        return;
      }
      hash.update(value);
      await pump();
    };

    pump().catch(reject);
  });
}

async function uploadFile(bucket: Bucket, filePath: string, file: File): Promise<void> {
  const blob = bucket.file(filePath);
  const blobStream = blob.createWriteStream();

  return new Promise((resolve, reject) => {
    const reader = file.stream().getReader();

    const pump = async () => {
      const { done, value } = await reader.read();
      if (done) {
        blobStream.end();
        resolve();
        return;
      }
      blobStream.write(value);
      await pump();
    };

    pump().catch(reject);
  });
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get('file') as File;
    const cedula = formData.get('cedula') as string;

    if (!file) {
      return NextResponse.json({ message: 'No files uploaded' }, { status: 400 });
    }

    if (!cedula) {
      return NextResponse.json({ message: 'Cedula is required' }, { status: 400 });
    }

    const hash = await generateVideoHash(file);

    const videoPath = `videos/${cedula}/${hash}.mp4`;

    if (!bucketName) {
      throw new Error('Environment variable GOOGLE_BUCKET_NAME is not defined');
    }
    const bucket = storage.bucket(bucketName);

    // Check if the file already exists
    const [exists] = await bucket.file(videoPath).exists();
    if (exists) {
      return NextResponse.json({ message: 'File already exists', filePath: `gs://${bucketName}/${videoPath}` }, { status: 200 });
    }

    await uploadFile(bucket, videoPath, file);

    return NextResponse.json({ message: 'File uploaded successfully', filePath: `gs://${bucketName}/${videoPath}` }, { status: 200 });
  } catch (err) {
    console.error('Error uploading file:', err);
    // @ts-ignore
    return NextResponse.json({ message: 'Error uploading file', error: err.message }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({ message: 'Method not allowed' }, { status: 405 });
}
