import React from "react";
import { Mood } from "@avatar-os/primitives";

export const Mouth: React.FC<{ mood: Mood }> = ({ mood }) => {
  switch (mood) {
    case Mood.HAPPY:
    case Mood.PLAYFUL:
    case Mood.EXCITED:
      return <path d="M 48 70 Q 60 84 72 70" fill="none" stroke="#ffffff" strokeWidth="4" strokeLinecap="round" />;
    case Mood.SAD:
      return <path d="M 48 76 Q 60 66 72 76" fill="none" stroke="#ffffff" strokeWidth="3" strokeLinecap="round" />;
    case Mood.SLEEPING:
      return <ellipse cx="60" cy="72" rx="3" ry="4" fill="#ffffff" />;
    default:
      return <rect x="52" y="72" width="16" height="4" rx="2" fill="#ffffff" />;
  }
};
