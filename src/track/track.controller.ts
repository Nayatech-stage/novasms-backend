import { Controller, Get, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ApiTags } from '@nestjs/swagger';
import { TrackService } from './track.service';

const ONE_PIXEL_GIF = Buffer.from(
  'R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==',
  'base64',
);

function toSafeRedirect(rawUrl?: string): string {
  if (!rawUrl) {
    return '/';
  }

  try {
    const decoded = decodeURIComponent(rawUrl);
    const parsed = new URL(decoded);

    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return decoded;
    }
  } catch {
    // fallback below
  }

  return '/';
}

@ApiTags('Tracking')
@Controller('track')
export class TrackController {
  constructor(private readonly trackService: TrackService) {}

  @Get('open')
  async open(
    @Query('sendId') sendId: string,
    @Query('t') token: string,
    @Res() res: Response,
  ) {
    await this.trackService.trackOpen(sendId, token);

    res.setHeader('Content-Type', 'image/gif');
    res.setHeader(
      'Cache-Control',
      'no-store, no-cache, must-revalidate, private',
    );
    res.setHeader('Pragma', 'no-cache');
    res.status(200).send(ONE_PIXEL_GIF);
  }

  @Get('click')
  async click(
    @Query('sendId') sendId: string,
    @Query('url') targetUrl: string,
    @Query('t') token: string,
    @Query('z') zone: string,
    @Res() res: Response,
  ) {
    const destination = toSafeRedirect(targetUrl);

    await this.trackService.trackClick(sendId, token, zone);
    res.redirect(302, destination);
  }
}
