import { ArrowRight, Boxes, Clapperboard, Palette, Sparkles } from "lucide-react";
import kcLogo from "./assets/kc-logo.png";

export function LaunchSplash({ onContinue }: { onContinue: () => void }) {
  return (
    <section className="kc-launch-splash" aria-label="Giới thiệu KC Auto Tool">
      <div className="kc-splash-glow is-left" />
      <div className="kc-splash-glow is-right" />
      <div className="kc-splash-card">
        <div className="kc-splash-logo"><img src={kcLogo} alt="Logo KC Auto Tool" /></div>
        <p className="kc-splash-kicker"><Sparkles size={13} /> AI VIDEO PRODUCTION AUTOMATION</p>
        <h1>KC Auto Tool</h1>
        <p className="kc-splash-subtitle">Automated Voice, Prompt, Image and Video Workflow</p>
        <div className="kc-splash-capabilities" aria-hidden="true">
          <span><Boxes size={14} /> Workflow</span>
          <span><Clapperboard size={14} /> Production</span>
          <span><Palette size={14} /> Visual Design</span>
        </div>
        <div className="kc-splash-credit">
          <strong>Sản phẩm được phát triển bởi NTC Media</strong>
          <span>Chịu trách nhiệm dự án · Project Manager · Developer · Designer · Automation Engineer</span>
          <b>Kwang Chun <i>aka</i> Quang Trung</b>
        </div>
        <div className="kc-splash-loader"><i /></div>
        <button type="button" onClick={onContinue}>Vào ứng dụng <ArrowRight size={15} /></button>
      </div>
    </section>
  );
}
