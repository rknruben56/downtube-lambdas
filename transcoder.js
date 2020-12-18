const child_process = require('child_process')
const fs = require('fs');
const path = require('path');

const AWS = require('aws-sdk');
const request = require('request');
const tempy = require('tempy');

const s3 = new AWS.S3();

exports.handler = async (event, context, callback) => {
  callback();

  // Extract event params
  const { mp3Key, url } = event;
  const filename = event.filename || path.basename(mp3Key);
  const logKey = event.logKey || `${mp3Key}.log`;
  const s3Bucket = event.s3Bucket || 'downtube-bucket';

  // Create temp I/O filenames
  const inputFilename = tempy.file();
  const mp3Filename = tempy.file({ extension: 'mp3' });

  try {
    await downloadSourceFile(url, inputFilename);
    const logContent = transcode(inputFilename, mp3Filename);
    await uploadMp3ToS3(mp3Filename, s3Bucket, mp3Key, filename, logKey, logContent);
  } catch (err) {
    console.log(err);
  }

  deleteTempFiles(inputFilename, mp3Filename);
}

downloadSourceFile = (url, inputFilename) => {
  return new Promise((resolve, revoke) => {
    const writeStream = fs.createWriteStream(inputFilename);
    writeStream.on('finish', resolve);
    writeStream.on('error', revoke);
    request(url).pipe(writeStream);
  });
}

transcode = (inputFilename, mp3Filename) => {
  // Use the Exodus ffmpeg bundled executable
  const ffmpeg = path.resolve(__dirname, 'exodus', 'bin', 'ffmpeg');

  // Convert the FLV file to mp3
  const ffmpegArgs = [
    '-i', inputFilename,
    '-vn', // Disable the video stream in the output
    '-acodec', 'libmp3lame', // use Lame for mp3 encoding
    '-ac', '2', // Set 2 audio channels
    '-q:a', '6', // Set quality to about 128 kb/s
    mp3Filename,
  ];
  const process = child_process.spawnSync(ffmpeg, ffmpegArgs);
  return process.stdout.toString() + process.stderr.toString();
}

uploadMp3ToS3 = (mp3Filename, s3Bucket, mp3Key, filename, logKey, logContent) => {
  return new Promise((resolve, revoke) => {
    s3.putObject({
      Body: fs.createReadStream(mp3Filename),
      Bucket: s3Bucket,
      Key: mp3Key,
      ContentDisposition: `attachment; filename="${filename.replace('"', '\'')}"`,
      ContentType: 'audio/mpeg',
    }, error => {
      if (error) {
        revoke(error);
      } else {
        // Update a log of the FFmpeg output
        const logFileName = path.basename(logKey);
        s3.putObject({
          Body: logContent,
          Bucket: s3Bucket,
          ContentType: 'text/plain',
          ContentDisposition: `inline; filename="${logFileName.repalce('"', '\'')}"`,
          Key: logKey,
        }, error => error ? revoke(error) : resolve());
      }
    })
  });
}

deleteTempFiles = (inputFilename, mp3Filename) => {
  [inputFilename, mp3Filename].forEach(filename => {
    if (fs.existsSync(filename)) {
      fs.unlinkSync(filename);
    }
  });
}