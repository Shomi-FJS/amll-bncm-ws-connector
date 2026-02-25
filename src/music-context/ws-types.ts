export interface WSArtist {
	id: string;
	name: string;
}

export interface WSLyricWord {
	startTime: number;
	endTime: number;
	word: string;
	romanWord: string;
}

export interface WSLyricLine {
	startTime: number;
	endTime: number;
	words: WSLyricWord[];
	isBG: boolean;
	isDuet: boolean;
	translatedLyric: string;
	romanLyric: string;
}

export interface WSMusicInfo {
	musicId: string;
	musicName: string;
	albumId: string;
	albumName: string;
	artists: WSArtist[];
	duration: number;
}

export interface WSImageData {
	mimeType: string;
	data: string;
}

export type WSAlbumCover =
	| { source: "uri"; url: string }
	| { source: "data"; image: WSImageData };

export type WSLyricContent =
	| { format: "structured"; lines: WSLyricLine[] }
	| { format: "ttml"; data: string };

export type WSCommand =
	| { command: "pause" }
	| { command: "resume" }
	| { command: "forwardSong" }
	| { command: "backwardSong" }
	| { command: "setVolume"; volume: number }
	| { command: "seekPlayProgress"; progress: number };

export type WSStateUpdate =
	| ({ update: "setMusic" } & WSMusicInfo)
	| ({ update: "setCover" } & WSAlbumCover)
	| ({ update: "setLyric" } & WSLyricContent)
	| { update: "progress"; progress: number }
	| { update: "volume"; volume: number }
	| { update: "paused" }
	| { update: "resumed" }
	| { update: "audioData"; data: number[] };

export type WSPayload =
	| { type: "initialize" }
	| { type: "ping" }
	| { type: "pong" }
	| { type: "command"; value: WSCommand }
	| { type: "state"; value: WSStateUpdate };
