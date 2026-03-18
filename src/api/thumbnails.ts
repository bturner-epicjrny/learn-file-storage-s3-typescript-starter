import { getBearerToken, validateJWT } from "../auth";
import { respondWithJSON } from "./json";
import { getVideo, updateVideo } from "../db/videos";
import type { ApiConfig } from "../config";
import type { BunRequest } from "bun";
import {
  BadRequestError,
  NotFoundError,
  UserForbiddenError,
} from "./errors";
import path from "path";

export async function handlerUploadThumbnail(cfg: ApiConfig, req: BunRequest) {
  const { videoId } = req.params as { videoId?: string };
  if (!videoId) {
    throw new BadRequestError("Invalid video ID");
  }

  const token = getBearerToken(req.headers);
  const userID = validateJWT(token, cfg.jwtSecret);

  const formData = await req.formData();
  const file = formData.get("thumbnail");

  if (!(file instanceof File)) {
    throw new BadRequestError("Thumbnail file missing");
  }

  const MAX_UPLOAD_SIZE = 10 << 20;
  if (file.size > MAX_UPLOAD_SIZE) {
    throw new BadRequestError("Thumbnail file too large");
  }

  const video = getVideo(cfg.db, videoId);
  if (!video) {
    throw new NotFoundError("Couldn't find video");
  }

  if (video.userID !== userID) {
    throw new UserForbiddenError("You are not the owner of this video");
  }

  const mediaType = file.type;
  const extension = mediaType.split("/")[1];
  if (!extension) {
    throw new BadRequestError("Invalid thumbnail media type");
  }

  const fileName = `${videoId}.${extension}`;
  const filePath = path.join(cfg.assetsRoot, fileName);

  await Bun.write(filePath, file);

  const thumbnailURL = `http://localhost:${cfg.port}/assets/${fileName}`;
  const updatedVideo = {
    ...video,
    thumbnailURL,
  };

  updateVideo(cfg.db, updatedVideo);

  return respondWithJSON(200, updatedVideo);
}
