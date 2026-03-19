import { respondWithJSON } from "./json";
import { getBearerToken, validateJWT } from "../auth";
import { getVideo, updateVideo } from "../db/videos";
import {
  BadRequestError,
  NotFoundError,
  UserForbiddenError,
} from "./errors";

import { type ApiConfig } from "../config";
import type { BunRequest } from "bun";
import { randomBytes } from "crypto";
import path from "path";

export async function handlerUploadVideo(cfg: ApiConfig, req: BunRequest) {
  const { videoId } = req.params as { videoId?: string };
  if (
    !videoId ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      videoId,
    )
  ) {
    throw new BadRequestError("Invalid video ID");
  }

  const token = getBearerToken(req.headers);
  const userID = validateJWT(token, cfg.jwtSecret);

  const video = getVideo(cfg.db, videoId);
  if (!video) {
    throw new NotFoundError("Couldn't find video");
  }

  if (video.userID !== userID) {
    throw new UserForbiddenError("You are not the owner of this video");
  }

  const formData = await req.formData();
  const file = formData.get("video");

  if (!(file instanceof File)) {
    throw new BadRequestError("Video file missing");
  }

  const MAX_UPLOAD_SIZE = 1 << 30;
  if (file.size > MAX_UPLOAD_SIZE) {
    throw new BadRequestError("Video file too large");
  }

  if (file.type !== "video/mp4") {
    throw new BadRequestError("Video must be an MP4");
  }

  const ext = "mp4";
  const tempFileName = `${randomBytes(32).toString("hex")}.${ext}`;
  const tempFilePath = path.join(cfg.filepathRoot, tempFileName);

  await Bun.write(tempFilePath, file);

  try {
    const key = `${randomBytes(32).toString("hex")}.${ext}`;
    const s3File = cfg.s3Client.file(key, {
      bucket: cfg.s3Bucket,
      type: file.type,
    });

    await s3File.write(Bun.file(tempFilePath));

    const videoURL = `https://${cfg.s3Bucket}.s3.${cfg.s3Region}.amazonaws.com/${key}`;
    const updatedVideo = {
      ...video,
      videoURL,
    };

    updateVideo(cfg.db, updatedVideo);

    return respondWithJSON(200, updatedVideo);
  } finally {
    await Bun.file(tempFilePath).delete().catch(() => {});
  }
}
