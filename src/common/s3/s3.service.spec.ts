import { Readable } from 'stream';
import { S3Service } from './s3.service';

const sendMock = jest.fn();
jest.mock('@aws-sdk/client-s3', () => {
  const actual = jest.requireActual('@aws-sdk/client-s3');
  return {
    ...actual,
    S3Client: jest.fn().mockImplementation(() => ({ send: sendMock })),
  };
});

describe('S3Service — downloadFile', () => {
  let service: S3Service;

  beforeEach(() => {
    sendMock.mockReset();
    service = new S3Service({
      region: 'us-east-2',
      credentials: { accessKeyId: 'AK', secretAccessKey: 'SK' },
      bucket: 'rocketautomotive',
    } as any);
  });

  it('baixa o objeto do S3 e devolve o buffer completo', async () => {
    const chunks = [Buffer.from('hello '), Buffer.from('world')];
    sendMock.mockResolvedValueOnce({ Body: Readable.from(chunks) });

    const buffer = await service.downloadFile('products/p1/img.jpg');

    expect(buffer.toString()).toBe('hello world');
    expect(sendMock).toHaveBeenCalledTimes(1);
    const command = sendMock.mock.calls[0][0];
    expect(command.input).toEqual({ Bucket: 'rocketautomotive', Key: 'products/p1/img.jpg' });
  });

  it('propaga o erro quando o objeto não existe', async () => {
    sendMock.mockRejectedValueOnce(Object.assign(new Error('not found'), { name: 'NoSuchKey' }));

    await expect(service.downloadFile('products/p1/missing.jpg')).rejects.toThrow('not found');
  });
});
