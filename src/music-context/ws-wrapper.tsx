import { type FC, useCallback, useEffect, useRef } from "react";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import {
	currentTimeAtom,
	musicArtistsAtom,
	musicContextAtom,
	musicCoverAtom,
	musicDurationAtom,
	musicIdAtom,
	musicNameAtom,
	playStatusAtom,
} from "./wrapper";
import { log, warn } from "../utils/logger";
import { enableWSPlayer, wsPlayerURL } from "../components/config/atoms";
import { debounce } from "../utils/debounce";
import { lyricLinesAtom } from "../lyric/provider";
import { PlayState, type MusicStatusGetterEvents } from ".";
import { ConnectionColor, wsConnectionStatusAtom } from "./ws-states";
import type { WSPayload, WSStateUpdate, WSCommand, WSLyricLine } from "./ws-types.js";

export const WebSocketWrapper: FC = () => {
	const musicId = useAtomValue(musicIdAtom);
	const musicName = useAtomValue(musicNameAtom);
	const musicCover = useAtomValue(musicCoverAtom);
	const musicDuration = useAtomValue(musicDurationAtom);
	const lyricLines = useAtomValue(lyricLinesAtom);
	const artists = useAtomValue(musicArtistsAtom);
	const musicContext = useAtomValue(musicContextAtom);
	const playProgress = useAtomValue(currentTimeAtom);
	const playStatus = useAtomValue(playStatusAtom);
	const [wsStatus, setWSStatus] = useAtom(wsConnectionStatusAtom);
	const enabled = useAtomValue(enableWSPlayer);
	const url = useAtomValue(wsPlayerURL);
	const ws = useRef<WebSocket>();

	const sendWSPayload = useCallback(function sendWSPayload(payload: WSPayload) {
		try {
			ws.current?.send(JSON.stringify(payload));
		} catch (err) {
			warn("发送消息到播放器失败", err);
			warn("出错的消息", payload);
		}
	}, []);

	const sendStateUpdate = useCallback(function sendStateUpdate(value: WSStateUpdate) {
		sendWSPayload({ type: "state", value });
	}, [sendWSPayload]);

	useEffect(() => {
		if (wsStatus.color !== ConnectionColor.Active) return;
		sendStateUpdate({
			update: "setMusic",
			musicId,
			musicName,
			albumId: "",
			albumName: "",
			artists: artists.map((v) => ({
				id: String(v.id),
				name: v.name,
			})),
			duration: musicDuration,
		});
	}, [musicId, musicName, musicDuration, artists, wsStatus, sendStateUpdate]);

	useEffect(() => {
		if (wsStatus.color !== ConnectionColor.Active) return;
		sendStateUpdate({
			update: "progress",
			progress: playProgress,
		});
	}, [playProgress, sendStateUpdate, wsStatus]);

	useEffect(() => {
		if (wsStatus.color !== ConnectionColor.Active) return;
		if (lyricLines.state === "hasData") {
			const clampTime = (time: number) =>
				Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, time | 0));
			sendStateUpdate({
				update: "setLyric",
				format: "structured",
				lines: lyricLines.data.map((line) => ({
					...line,
					startTime: clampTime(line.startTime),
					endTime: clampTime(line.endTime),
					words: line.words.map((word) => ({
						...word,
						romanWord: "",
						startTime: clampTime(word.startTime),
						endTime: clampTime(word.endTime),
					})),
				})),
			});
		}
	}, [lyricLines, sendStateUpdate, wsStatus]);

	useEffect(() => {
		if (wsStatus.color !== ConnectionColor.Active) return;
		sendStateUpdate({
			update: "setCover",
			source: "uri",
			url: musicCover,
		});
	}, [musicCover, sendStateUpdate, wsStatus]);

	useEffect(() => {
		if (wsStatus.color !== ConnectionColor.Active) return;
		if (playStatus === PlayState.Pausing) {
			sendStateUpdate({ update: "paused" });
		} else if (playStatus === PlayState.Playing) {
			sendStateUpdate({ update: "resumed" });
		}
	}, [playStatus, sendStateUpdate, wsStatus]);

	useEffect(() => {
		if (musicContext && wsStatus.color === ConnectionColor.Active) {
			musicContext.acquireAudioData();
			const onAudioData = (evt: MusicStatusGetterEvents["audio-data"]) => {
				const data = Array.from(new Uint8Array(evt.detail.data));
				sendStateUpdate({ update: "audioData", data });
			};
			musicContext.addEventListener("audio-data", onAudioData);
			return () => {
				musicContext.removeEventListener("audio-data", onAudioData);
				musicContext.releaseAudioData();
			};
		}
	}, [musicContext, wsStatus, sendStateUpdate]);

	useEffect(() => {
		if (!enabled) {
			setWSStatus({
				color: ConnectionColor.Disabled,
				progress: false,
				text: "未开启",
			});
			return;
		}
		let webSocket: WebSocket | undefined = undefined;
		let canceled = false;

		const connect = () => {
			if (canceled) return;
			setWSStatus({
				progress: true,
				color: ConnectionColor.Connecting,
				text: "正在连接",
			});

			webSocket?.close();
			try {
				webSocket = new WebSocket(url);
			} catch (err) {
				warn("连接到播放器失败", err);
				setWSStatus({
					progress: false,
					color: ConnectionColor.Error,
					text: "连接时出错，五秒后重试",
				});
				enqueueConnect();
				return;
			}
			const nowWS = webSocket;

			webSocket.addEventListener("message", async (evt) => {
				if (nowWS !== webSocket || canceled) return;
				let payload: WSPayload;
				try {
					if (typeof evt.data === "string") {
						payload = JSON.parse(evt.data);
					} else if (evt.data instanceof ArrayBuffer) {
						payload = JSON.parse(new TextDecoder().decode(evt.data));
					} else if (evt.data instanceof Blob) {
						payload = JSON.parse(new TextDecoder().decode(await evt.data.arrayBuffer()));
					} else {
						warn("未知的数据类型", evt.data);
						return;
					}
				} catch (err) {
					warn("解析消息失败", err);
					return;
				}

				if (payload.type === "ping") {
					sendWSPayload({ type: "pong" });
					return;
				}

				if (payload.type === "command") {
					const cmd = payload.value as WSCommand;
					switch (cmd.command) {
						case "pause":
							musicContext?.pause();
							break;
						case "resume":
							musicContext?.resume();
							break;
						case "forwardSong":
							musicContext?.forwardSong();
							break;
						case "backwardSong":
							musicContext?.rewindSong();
							break;
						case "setVolume":
							musicContext?.setVolume(cmd.volume);
							break;
						case "seekPlayProgress":
							musicContext?.seekToPosition(cmd.progress);
							break;
					}
				}
			});

			webSocket.addEventListener("error", () => {
				if (nowWS !== webSocket || canceled) return;
				webSocket = undefined;
				ws.current = undefined;
				setWSStatus({
					progress: false,
					color: ConnectionColor.Error,
					text: "连接失败，五秒后重试",
				});
				warn("连接到播放器失败");
				enqueueConnect();
			});

			webSocket.addEventListener("close", () => {
				if (nowWS !== webSocket || canceled) return;
				webSocket = undefined;
				ws.current = undefined;
				setWSStatus({
					progress: false,
					color: ConnectionColor.Error,
					text: "连接已关闭，五秒后重试",
				});
				warn("连接到播放器失败");
				enqueueConnect();
			});

			webSocket.addEventListener("open", () => {
				if (nowWS !== webSocket || canceled) return;
				setWSStatus({
					progress: false,
					color: ConnectionColor.Active,
					text: "已连接",
				});
				log("已连接到播放器");
				ws.current?.close();
				ws.current = webSocket;
				sendWSPayload({ type: "initialize" });
			});
		};
		const enqueueConnect = debounce(connect, 5000);

		try {
			connect();
		} catch (err) {
			console.error(err);
		}

		return () => {
			webSocket?.close();
			webSocket = undefined;
			canceled = true;
			setWSStatus({
				color: ConnectionColor.Disabled,
				progress: false,
				text: "未开启",
			});
		};
	}, [enabled, url, musicContext, setWSStatus, sendWSPayload]);

	return null;
};
