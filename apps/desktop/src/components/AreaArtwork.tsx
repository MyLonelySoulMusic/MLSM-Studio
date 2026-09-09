import type { AnimationCategoryId } from "../services/animation-modes";

/**
 * Small, deliberately quiet visual studies for the area cards on the studio
 * home screen. These are kept as SVG rather than icon glyphs so each area can
 * carry a little bit of its own visual language at card size.
 */
export function AreaArtwork({ category }: { category: AnimationCategoryId }) {
  return (
    <svg viewBox="0 0 320 110" aria-hidden="true" focusable="false">
      {category === "soundAnimation" ? <SoundAnimationArtwork /> : null}
      {category === "photoVideoStudio" ? <PhotoVideoStudioArtwork /> : null}
      {category === "videoEditor" ? <VideoEditorArtwork /> : null}
      {category === "music" ? <MusicArtwork /> : null}
      {category === "lipsync" ? <LipSyncArtwork /> : null}
      {category === "audio" ? <AudioArtwork /> : null}
    </svg>
  );
}

function SoundAnimationArtwork() {
  return (
    <g>
      <circle cx="68" cy="55" r="40" fill="none" stroke="var(--line)" strokeWidth="1" opacity=".8" />
      <circle cx="68" cy="55" r="30" fill="var(--panel)" stroke="var(--accent-soft)" strokeWidth="1" opacity=".92" />
      <path d="M68 15a40 40 0 0 1 35 20" fill="none" stroke="var(--accent)" strokeWidth="3" opacity=".8" />
      <path d="M68 95a40 40 0 0 1-35-20" fill="none" stroke="var(--accent-strong)" strokeWidth="2" opacity=".62" />
      <g fill="none" stroke="var(--accent-soft)" strokeWidth="3" strokeLinecap="round" opacity=".86">
        <path d="M68 7v8" />
        <path d="M88 12l-3 8" />
        <path d="m105 23-6 6" />
        <path d="m117 40-8 3" />
        <path d="M121 60h-8" />
        <path d="m115 78-8-3" />
        <path d="m101 92-6-6" />
        <path d="M82 101l-3-8" />
        <path d="M48 101l3-8" />
        <path d="m31 91 6-6" />
        <path d="m19 73 8-3" />
        <path d="M15 52h8" />
        <path d="m20 34 8 3" />
        <path d="m34 19 6 6" />
        <path d="M52 10l3 8" />
      </g>
      <path d="M35 56h9l5-11 7 21 8-34 8 44 8-27 7 14 7-7h10" fill="none" stroke="var(--ink)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M141 56h31m11 0h25m11 0h48" fill="none" stroke="var(--line)" strokeWidth="1" opacity=".8" />
      <path d="M141 56h31m11 0h25m11 0h48" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeDasharray="1 8" opacity=".76" />
      <circle cx="141" cy="56" r="3" fill="var(--accent-strong)" />
      <circle cx="267" cy="56" r="3" fill="var(--accent-soft)" />
    </g>
  );
}

function PhotoVideoStudioArtwork() {
  return (
    <g>
      <rect x="24" y="17" width="118" height="74" rx="9" fill="var(--panel)" stroke="var(--line)" strokeWidth="1" opacity=".72" />
      <rect x="39" y="12" width="118" height="74" rx="9" fill="var(--accent-soft)" stroke="var(--accent)" strokeWidth="1" opacity=".62" />
      <rect x="55" y="19" width="118" height="74" rx="9" fill="var(--panel)" stroke="var(--accent-strong)" strokeWidth="1.6" />
      <path d="M65 77 88 50l15 15 11-12 22 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M65 79h96" fill="none" stroke="var(--line)" strokeWidth="1" />
      <circle cx="82" cy="35" r="6" fill="var(--accent-soft)" stroke="var(--accent-strong)" strokeWidth="1.5" />
      <path d="M193 25h83v60h-83z" fill="none" stroke="var(--line)" strokeWidth="1" strokeDasharray="3 5" opacity=".9" />
      <path d="M204 37h61M204 47h38M204 67h62M204 77h46" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" opacity=".64" />
      <path d="M201 91h76" fill="none" stroke="var(--accent-soft)" strokeWidth="3" strokeLinecap="round" opacity=".75" />
    </g>
  );
}

function VideoEditorArtwork() {
  return (
    <g>
      <rect x="22" y="13" width="122" height="48" rx="8" fill="var(--panel)" stroke="var(--line)" strokeWidth="1" />
      <path d="M32 49 53 33l16 10 17-16 45 22" fill="none" stroke="var(--accent)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M32 23h102M32 29h55" fill="none" stroke="var(--line)" strokeWidth="1" opacity=".75" />
      <rect x="22" y="70" width="274" height="27" rx="7" fill="var(--panel)" stroke="var(--line)" strokeWidth="1" />
      <path d="M34 78h250M34 89h250" fill="none" stroke="var(--line)" strokeWidth="1" opacity=".76" />
      <rect x="36" y="74" width="54" height="8" rx="3" fill="var(--accent-soft)" opacity=".76" />
      <rect x="97" y="74" width="80" height="8" rx="3" fill="var(--accent)" opacity=".78" />
      <rect x="183" y="74" width="39" height="8" rx="3" fill="var(--accent-soft)" opacity=".64" />
      <rect x="228" y="74" width="55" height="8" rx="3" fill="var(--accent-strong)" opacity=".7" />
      <rect x="39" y="85" width="70" height="8" rx="3" fill="var(--accent)" opacity=".42" />
      <rect x="117" y="85" width="45" height="8" rx="3" fill="var(--accent-soft)" opacity=".9" />
      <rect x="170" y="85" width="94" height="8" rx="3" fill="var(--accent)" opacity=".48" />
      <path d="M177 64v36" fill="none" stroke="var(--accent-strong)" strokeWidth="2" />
      <circle cx="177" cy="64" r="4" fill="var(--accent-strong)" />
      <path d="M26 66h268" fill="none" stroke="var(--accent-soft)" strokeWidth="1" strokeDasharray="1 7" opacity=".72" />
    </g>
  );
}

function MusicArtwork() {
  return (
    <g>
      <rect x="25" y="13" width="270" height="84" rx="12" fill="var(--panel)" stroke="var(--line)" strokeWidth="1" />
      <path d="M39 30h242" fill="none" stroke="var(--line)" strokeWidth="1" opacity=".8" />
      <path d="M52 22h44M119 22h32M174 22h37M233 22h33" fill="none" stroke="var(--accent-soft)" strokeWidth="2" strokeLinecap="round" opacity=".88" />
      <g fill="none" stroke="var(--line)" strokeWidth="2" strokeLinecap="round">
        <path d="M55 40v42" />
        <path d="M99 40v42" />
        <path d="M143 40v42" />
        <path d="M187 40v42" />
        <path d="M231 40v42" />
        <path d="M275 40v42" />
      </g>
      <g stroke="var(--accent)" strokeWidth="4" strokeLinecap="round">
        <path d="M55 54v9" />
        <path d="M99 66v9" />
        <path d="M143 47v9" />
        <path d="M187 59v9" />
        <path d="M231 51v9" />
        <path d="M275 70v9" />
      </g>
      <g fill="var(--accent-strong)" stroke="var(--panel)" strokeWidth="1.5">
        <circle cx="55" cy="54" r="5" />
        <circle cx="99" cy="66" r="5" />
        <circle cx="143" cy="47" r="5" />
        <circle cx="187" cy="59" r="5" />
        <circle cx="231" cy="51" r="5" />
        <circle cx="275" cy="70" r="5" />
      </g>
      <path d="M40 88h241" fill="none" stroke="var(--accent-soft)" strokeWidth="2" strokeLinecap="round" opacity=".8" />
    </g>
  );
}

function LipSyncArtwork() {
  return (
    <g>
      <rect x="22" y="14" width="276" height="82" rx="11" fill="var(--panel)" stroke="var(--line)" strokeWidth="1" />
      <path d="M34 55h252" fill="none" stroke="var(--line)" strokeWidth="1" opacity=".9" />
      <path d="M34 35c9-13 17 13 26 0s17-13 26 0 17 13 26 0 17-13 26 0 17 13 26 0 17-13 26 0 17 13 26 0 17-13 26 0 17 13 26 0 17-13 26 0" fill="none" stroke="var(--accent-strong)" strokeWidth="2.3" strokeLinecap="round" opacity=".96" />
      <path d="M34 75c11-6 20 6 31 0s20 6 31 0 20 6 31 0 20 6 31 0 20 6 31 0 20 6 31 0 20 6 31 0 20 6 31 0 20 6 31 0" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeDasharray="1 5" opacity=".82" />
      <g stroke="var(--accent-soft)" strokeWidth="1.4" opacity=".9">
        <path d="M64 23v64" />
        <path d="M112 23v64" />
        <path d="M161 23v64" />
        <path d="M210 23v64" />
        <path d="M258 23v64" />
      </g>
      <g fill="var(--panel)" stroke="var(--accent-strong)" strokeWidth="2">
        <circle cx="64" cy="35" r="4" />
        <circle cx="112" cy="35" r="4" />
        <circle cx="161" cy="35" r="4" />
        <circle cx="210" cy="35" r="4" />
        <circle cx="258" cy="35" r="4" />
      </g>
      <g fill="var(--accent-soft)">
        <rect x="58" y="69" width="12" height="11" rx="2" />
        <rect x="106" y="69" width="12" height="11" rx="2" />
        <rect x="155" y="69" width="12" height="11" rx="2" />
        <rect x="204" y="69" width="12" height="11" rx="2" />
        <rect x="252" y="69" width="12" height="11" rx="2" />
      </g>
    </g>
  );
}

function AudioArtwork() {
  return (
    <g>
      <rect x="22" y="13" width="276" height="84" rx="11" fill="var(--panel)" stroke="var(--line)" strokeWidth="1" />
      <g stroke="var(--line)" strokeWidth="1" opacity=".7">
        <path d="M36 31h248" />
        <path d="M36 55h248" />
        <path d="M36 79h248" />
        <path d="M76 22v66M124 22v66M172 22v66M220 22v66M268 22v66" />
      </g>
      <g fill="var(--accent-soft)" opacity=".74">
        <rect x="39" y="46" width="6" height="18" rx="3" />
        <rect x="50" y="38" width="6" height="34" rx="3" />
        <rect x="61" y="28" width="6" height="54" rx="3" />
        <rect x="72" y="41" width="6" height="28" rx="3" />
        <rect x="84" y="35" width="6" height="40" rx="3" />
        <rect x="96" y="25" width="6" height="60" rx="3" />
        <rect x="108" y="43" width="6" height="24" rx="3" />
        <rect x="120" y="33" width="6" height="44" rx="3" />
        <rect x="132" y="40" width="6" height="30" rx="3" />
        <rect x="144" y="22" width="6" height="66" rx="3" />
        <rect x="156" y="37" width="6" height="36" rx="3" />
        <rect x="168" y="29" width="6" height="52" rx="3" />
        <rect x="180" y="44" width="6" height="22" rx="3" />
        <rect x="192" y="32" width="6" height="46" rx="3" />
        <rect x="204" y="40" width="6" height="30" rx="3" />
        <rect x="216" y="26" width="6" height="58" rx="3" />
        <rect x="228" y="36" width="6" height="38" rx="3" />
        <rect x="240" y="30" width="6" height="50" rx="3" />
        <rect x="252" y="43" width="6" height="24" rx="3" />
        <rect x="264" y="35" width="6" height="40" rx="3" />
      </g>
      <path d="M36 56c8-4 9 5 16 0s9-10 16 0 9 12 16 0 9-8 16 0 9 5 16 0 9-14 16 0 9 8 16 0 9-4 16 0 9 10 16 0 9-12 16 0 9 7 16 0 9-5 16 0 9 10 16 0 9-8 16 0 9 5 16 0 9-10 16 0 9 7 16 0 9-5 16 0" fill="none" stroke="var(--accent-strong)" strokeWidth="2.2" strokeLinecap="round" />
      <path d="M36 91h248" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" opacity=".72" />
      <circle cx="164" cy="91" r="4" fill="var(--accent-strong)" />
    </g>
  );
}
