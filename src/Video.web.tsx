import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type RefObject,
} from 'react';
import shaka from 'shaka-player';

import type {ReactVideoProps, VideoMetadata, VideoRef} from './types';

// stolen from https://stackoverflow.com/a/77278013/21726244
const isDeepEqual = <T,>(a: T, b: T): boolean => {
  if (a === b) {
    return true;
  }

  const bothAreObjects =
    a && b && typeof a === 'object' && typeof b === 'object';

  return Boolean(
    bothAreObjects &&
      Object.keys(a).length === Object.keys(b).length &&
      Object.entries(a).every(([k, v]) => isDeepEqual(v, b[k as keyof T])),
  );
};

const useMediaSession = (
  metadata: VideoMetadata | undefined,
  nativeRef: RefObject<HTMLVideoElement>,
  showNotification: boolean,
) => {
  const isPlaying = nativeRef.current && (nativeRef.current?.paused ?? false);
  const progress = nativeRef.current?.currentTime ?? 0;
  const duration = Number.isFinite(nativeRef.current?.duration)
    ? nativeRef.current?.duration
    : undefined;
  const playbackRate = nativeRef.current?.playbackRate ?? 1;

  const enabled = 'mediaSession' in navigator && showNotification;

  useEffect(() => {
    if (enabled) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: metadata?.title,
        artist: metadata?.artist,
        artwork: metadata?.imageUri ? [{src: metadata.imageUri}] : undefined,
      });
    }
  }, [enabled, metadata]);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    const seekTo = (time: number) => {
      if (nativeRef.current) {
        nativeRef.current.currentTime = time;
      }
    };

    const seekRelative = (offset: number) => {
      if (nativeRef.current) {
        nativeRef.current.currentTime = nativeRef.current.currentTime + offset;
      }
    };

    const mediaActions: [
      MediaSessionAction,
      MediaSessionActionHandler | null,
    ][] = [
      ['play', () => nativeRef.current?.play()],
      ['pause', () => nativeRef.current?.pause()],
      [
        'seekbackward',
        (evt: MediaSessionActionDetails) =>
          seekRelative(evt.seekOffset ? -evt.seekOffset : -10),
      ],
      [
        'seekforward',
        (evt: MediaSessionActionDetails) =>
          seekRelative(evt.seekOffset ? evt.seekOffset : 10),
      ],
      ['seekto', (evt: MediaSessionActionDetails) => seekTo(evt.seekTime!)],
    ];

    for (const [action, handler] of mediaActions) {
      try {
        navigator.mediaSession.setActionHandler(action, handler);
      } catch {
        // ignored
      }
    }
  }, [enabled, nativeRef]);

  useEffect(() => {
    if (enabled) {
      navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused';
    }
  }, [isPlaying, enabled]);
  useEffect(() => {
    if (enabled && duration !== undefined) {
      navigator.mediaSession.setPositionState({
        position: Math.min(progress, duration),
        duration,
        playbackRate: playbackRate,
      });
    }
  }, [progress, duration, playbackRate, enabled]);
};

const videoStyle = {
  position: 'absolute',
  inset: 0,
  objectFit: 'contain',
  width: '100%',
  height: '100%',
} satisfies React.CSSProperties;

const Video = forwardRef<VideoRef, ReactVideoProps>(
  (
    {
      source,
      paused,
      muted,
      volume,
      rate,
      repeat,
      controls,
      showNotificationControls = false,
      poster,
      fullscreen,
      fullscreenAutorotate,
      fullscreenOrientation,
      onBuffer,
      onLoad,
      onProgress,
      onPlaybackRateChange,
      onError,
      onReadyForDisplay,
      onSeek,
      onVolumeChange,
      onEnd,
      onPlaybackStateChanged,
    },
    ref,
  ) => {
    /*** References */
    const htmlVideoRef = useRef<HTMLVideoElement>(null);
    const shakaPlayerRef = useRef<shaka.Player | null>(null);
    const currentSourceProp = useRef(source);
    const isSeeking = useRef(false);

    /*** States */
    const [src, setSource] = useState(source);

    useMediaSession(src?.metadata, htmlVideoRef, showNotificationControls);

    const handleShakaError = useCallback(
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      //@ts-expect-error
      (event) => {
        const error = event.detail as shaka.util.Error;
        console.log(event);
        onError?.({error});
      },
      [onError],
    );

    const handleVideoHTMLError = useCallback(
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      //@ts-expect-error
      (event) => {
        const error = event;
        onError?.({error});
      },
      [onError],
    );

    const seek = useCallback(
      async (time: number, _tolerance?: number) => {
        if (isNaN(time)) {
          throw new Error('Specified time is not a number');
        }
        if (!htmlVideoRef.current) {
          console.warn('Video Component is not mounted');
          return;
        }
        time = Math.max(0, Math.min(time, htmlVideoRef.current.duration));
        htmlVideoRef.current.currentTime = time;
        onSeek?.({
          seekTime: time,
          currentTime: htmlVideoRef.current.currentTime,
        });
      },
      [onSeek],
    );

    const pause = useCallback(() => {
      htmlVideoRef.current?.pause();
    }, []);

    const resume = useCallback(() => {
      console.log('@@@@ call resume');
      if (!shakaPlayerRef.current) {
        return;
      }
      try {
        htmlVideoRef.current?.play();
        console.log('@@@@ play');
      } catch (error) {
        console.error('failed to resume', error);
      }
    }, []);

    const setVolume = useCallback((vol: number) => {
      if (!htmlVideoRef.current) {
        return;
      }
      htmlVideoRef.current.volume = Math.max(0, Math.min(vol, 100)) / 100;
    }, []);

    const getCurrentPosition = useCallback(async () => {
      if (!htmlVideoRef.current) {
        throw new Error('Video Component is not mounted');
      }
      return htmlVideoRef.current.currentTime;
    }, []);

    const unsupported = useCallback(() => {
      throw new Error('This is unsupported on the web');
    }, []);

    const setFullScreen = useCallback(
      async (
        newVal: boolean,
        orientation?: ReactVideoProps['fullscreenOrientation'],
        autorotate?: boolean,
      ) => {
        orientation ??= fsPrefs.current.fullscreenOrientation;
        autorotate ??= fsPrefs.current.fullscreenAutorotate;

        try {
          if (newVal) {
            await htmlVideoRef.current?.requestFullscreen({
              navigationUI: 'hide',
            });
            if (orientation === 'all' || !orientation || autorotate) {
              screen.orientation.unlock();
            } else {
              if (
                'lock' in screen.orientation &&
                typeof screen.orientation.lock === 'function'
              ) {
                await screen.orientation.lock(orientation);
              }
            }
          } else {
            if (document.fullscreenElement) {
              await document.exitFullscreen();
            }
            screen.orientation.unlock();
          }
        } catch (e) {
          // Changing fullscreen status without a button click is not allowed so it throws.
          // Some browsers also used to throw when locking screen orientation was not supported.
          console.error('Could not toggle fullscreen/screen lock status', e);
        }
      },
      [],
    );

    // Stock this in a ref to not invalidate memoization when those changes.
    const fsPrefs = useRef({
      fullscreenAutorotate,
      fullscreenOrientation,
    });
    fsPrefs.current = {
      fullscreenOrientation,
      fullscreenAutorotate,
    };

    const presentFullscreenPlayer = useCallback(
      () => setFullScreen(true),
      [setFullScreen],
    );
    const dismissFullscreenPlayer = useCallback(
      () => setFullScreen(false),
      [setFullScreen],
    );

    useImperativeHandle(
      ref,
      () => ({
        seek,
        setSource,
        pause,
        resume,
        setVolume,
        getCurrentPosition,
        presentFullscreenPlayer,
        dismissFullscreenPlayer,
        setFullScreen,
        save: unsupported,
        enterPictureInPicture: unsupported,
        exitPictureInPicture: unsupported,
        restoreUserInterfaceForPictureInPictureStopCompleted: unsupported,
        nativeHtmlVideoRef: htmlVideoRef,
      }),
      [
        seek,
        setSource,
        pause,
        resume,
        unsupported,
        setVolume,
        getCurrentPosition,
        htmlVideoRef,
        presentFullscreenPlayer,
        dismissFullscreenPlayer,
        setFullScreen,
      ],
    );

    useEffect(() => {
      const videoRef = htmlVideoRef.current; // Capture the current value of the ref
      shaka.polyfill.installAll();
      if (!videoRef) {
        return;
      }
      if (!shaka.Player.isBrowserSupported()) {
        return;
      }
      if (shaka && shaka.log) {
        shaka.log.setLevel(shaka.log.Level.DEBUG);
      } else {
        console.info('Shaka Player logging API is not available.');
      }
      console.log('@@@@ videoRef', videoRef);
      const player = shakaPlayerRef.current || new shaka.Player(videoRef);
      shakaPlayerRef.current = player;
      console.log('@@@@ load shaka');
      return () => {
        console.log('@@@@ UNMOUNT useEffect[]');
        player?.destroy();
      };
    }, []);

    useEffect(() => {
      if (isDeepEqual(source, currentSourceProp.current)) {
        return;
      }
      console.log('useEffect source: ', source);
      currentSourceProp.current = source;
      setSource(source);
    }, [source]);

    useEffect(() => {
      const videoRef = htmlVideoRef.current;
      const player = shakaPlayerRef.current;
      // Initialize Shaka Player once the component mounts
      const startPlayer = async () => {
        console.log('startPlayer with: ', src);
        try {
          const uri = src?.uri as string | undefined;
          if (!uri) {
            return;
          }
          // Load the video source (MPEG-DASH, HLS, or other supported formats)
          player?.addEventListener('error', handleShakaError);
          await player?.load(uri);
          console.log('The video has been loaded successfully');
        } catch (error) {
          if (
            error instanceof Error &&
            error.name.toLowerCase() === 'notallowederror'
          ) {
            console.log('need to show play to user interaction');
          }
          console.error('Error initializing Shaka Player:', error);
        }
      };

      startPlayer();
      // Cleanup the player when the component is unmounted
      return () => {
        console.log('@@@ UNMOUNT useEffect[src]');
        player?.removeEventListener('error', handleShakaError);
        videoRef?.pause();
      };
    }, [handleShakaError, handleVideoHTMLError, src]);

    useEffect(() => {
      setFullScreen(
        fullscreen || false,
        fullscreenOrientation,
        fullscreenAutorotate,
      ).catch((ex) => console.error(ex));
    }, [
      setFullScreen,
      fullscreen,
      fullscreenAutorotate,
      fullscreenOrientation,
    ]);

    useEffect(() => {
      if (volume === undefined || isNaN(volume)) {
        return;
      }
      setVolume(volume);
    }, [volume, setVolume]);

    useEffect(() => {
      // Not sure about how to do this but we want to wait for nativeRef to be initialized
      setTimeout(() => {
        if (!htmlVideoRef.current) {
          return;
        }

        // Set play state to the player's value (if autoplay is denied)
        // This is useful if our UI is in a play state but autoplay got denied so
        // the video is actually in a paused state.
        onPlaybackStateChanged?.({
          isPlaying: !htmlVideoRef.current.paused,
          isSeeking: isSeeking.current,
        });
      }, 500);
    }, [onPlaybackStateChanged]);

    useEffect(() => {
      if (!htmlVideoRef.current || rate === undefined) {
        return;
      }
      htmlVideoRef.current.playbackRate = rate;
    }, [rate]);

    return (
      <video
        ref={htmlVideoRef}
        muted={muted}
        autoPlay={!paused}
        controls={controls}
        loop={repeat}
        playsInline
        poster={
          typeof poster === 'object'
            ? typeof poster.source === 'object'
              ? poster.source.uri
              : undefined
            : poster
        }
        // onCanPlay={() => onBuffer?.({isBuffering: false})}
        // onWaiting={() => onBuffer?.({isBuffering: true})}
        onRateChange={() => {
          if (!htmlVideoRef.current) {
            return;
          }
          onPlaybackRateChange?.({
            playbackRate: htmlVideoRef.current?.playbackRate,
          });
        }}
        onDurationChange={() => {
          if (!htmlVideoRef.current) {
            return;
          }
          onLoad?.({
            currentTime: htmlVideoRef.current.currentTime,
            duration: htmlVideoRef.current.duration,
            videoTracks: [],
            textTracks: [],
            audioTracks: [],
            naturalSize: {
              width: htmlVideoRef.current.videoWidth,
              height: htmlVideoRef.current.videoHeight,
              orientation: 'landscape',
            },
          });
        }}
        onTimeUpdate={() => {
          if (!htmlVideoRef.current) {
            return;
          }
          onProgress?.({
            currentTime: htmlVideoRef.current.currentTime,
            playableDuration: htmlVideoRef.current.buffered.length
              ? htmlVideoRef.current.buffered.end(
                  htmlVideoRef.current.buffered.length - 1,
                )
              : 0,
            seekableDuration: 0,
          });
        }}
        onLoadedData={() => onReadyForDisplay?.()}
        onLoadedMetadata={() => {
          if (src?.startPosition) {
            seek(src.startPosition / 1000);
          }
        }}
        onPlay={() =>
          onPlaybackStateChanged?.({
            isPlaying: true,
            isSeeking: isSeeking.current,
          })
        }
        onPause={() =>
          onPlaybackStateChanged?.({
            isPlaying: false,
            isSeeking: isSeeking.current,
          })
        }
        onSeeking={() => (isSeeking.current = true)}
        onSeeked={() => {
          // only trigger this if it's from UI seek.
          // if it was triggered via ref.seek(), onSeek has already been called
          if (isSeeking.current) {
            isSeeking.current = false;
            onSeek?.({
              seekTime: htmlVideoRef.current!.currentTime,
              currentTime: htmlVideoRef.current!.currentTime,
            });
          }
        }}
        onVolumeChange={() => {
          if (!htmlVideoRef.current) {
            return;
          }
          onVolumeChange?.({volume: htmlVideoRef.current.volume});
        }}
        onEnded={onEnd}
        style={videoStyle}
      />
    );
  },
);

Video.displayName = 'Video';
export default Video;
