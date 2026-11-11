import React, { useState } from 'react';
import { 
  Cloud, 
  Terminal, 
  Copy, 
  Check, 
  X, 
  ExternalLink, 
  Layers, 
  Smartphone,
  Server,
  Zap
} from 'lucide-react';

interface DeployGuideModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const DeployGuideModal: React.FC<DeployGuideModalProps> = ({ isOpen, onClose }) => {
  const [activePlatform, setActivePlatform] = useState<'vercel' | 'aws' | 'pwa_mobile'>('vercel');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  if (!isOpen) return null;

  const copyCode = (key: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden border border-slate-200 flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 bg-slate-900 text-white flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-sky-500/20 border border-sky-400 flex items-center justify-center text-sky-400">
              <Cloud className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white">
                Cloud Deployment &amp; Publishing Guide
              </h2>
              <p className="text-xs text-slate-400">
                Deploy to Vercel, AWS (App Runner/ECS), or install as Offline PWA
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Platform Selector Tabs */}
        <div className="flex border-b border-slate-200 bg-slate-50 px-4 pt-2 gap-2 text-xs">
          <button
            onClick={() => setActivePlatform('vercel')}
            className={`flex items-center gap-2 px-4 py-2 font-bold border-b-2 transition ${
              activePlatform === 'vercel'
                ? 'border-black text-black bg-white rounded-t-lg'
                : 'border-transparent text-slate-500 hover:text-slate-900'
            }`}
          >
            <Zap className="w-3.5 h-3.5" />
            Vercel (1-Click)
          </button>
          <button
            onClick={() => setActivePlatform('aws')}
            className={`flex items-center gap-2 px-4 py-2 font-bold border-b-2 transition ${
              activePlatform === 'aws'
                ? 'border-orange-500 text-orange-600 bg-white rounded-t-lg'
                : 'border-transparent text-slate-500 hover:text-slate-900'
            }`}
          >
            <Server className="w-3.5 h-3.5" />
            AWS App Runner / ECS
          </button>
          <button
            onClick={() => setActivePlatform('pwa_mobile')}
            className={`flex items-center gap-2 px-4 py-2 font-bold border-b-2 transition ${
              activePlatform === 'pwa_mobile'
                ? 'border-blue-600 text-blue-600 bg-white rounded-t-lg'
                : 'border-transparent text-slate-500 hover:text-slate-900'
            }`}
          >
            <Smartphone className="w-3.5 h-3.5" />
            Install Offline PWA
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto space-y-4 text-xs flex-1">
          {activePlatform === 'vercel' && (
            <div className="space-y-4">
              <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200">
                <h4 className="font-bold text-slate-800 text-sm mb-1">
                  Deploying to Vercel
                </h4>
                <p className="text-slate-600 leading-relaxed">
                  The repository includes a ready-to-deploy <code className="bg-slate-200 px-1 py-0.5 rounded font-mono">vercel.json</code> configured with automatic SPA routing and asset compression.
                </p>
              </div>

              <div>
                <span className="font-bold text-slate-700 block mb-1">
                  Option 1: Deploy with Vercel CLI
                </span>
                <div className="relative bg-slate-900 text-slate-200 p-3 rounded-xl font-mono text-xs">
                  <div>npm install -g vercel</div>
                  <div>vercel deploy --prod</div>
                  <button
                    onClick={() => copyCode('vercel-cli', 'npm install -g vercel\nvercel deploy --prod')}
                    className="absolute right-2.5 top-2.5 p-1 bg-slate-800 hover:bg-slate-700 rounded text-slate-300"
                  >
                    {copiedKey === 'vercel-cli' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>

              <div>
                <span className="font-bold text-slate-700 block mb-1">
                  Option 2: Connect via GitHub
                </span>
                <p className="text-slate-600">
                  Push this project to a GitHub repository, visit vercel.com &rarr; &ldquo;Add New Project&rdquo;, and select the repo. Vercel will automatically build with <code className="bg-slate-100 px-1 rounded font-mono">npm run build</code> and publish to your custom domain.
                </p>
              </div>
            </div>
          )}

          {activePlatform === 'aws' && (
            <div className="space-y-4">
              <div className="p-3.5 bg-orange-50 rounded-xl border border-orange-200 text-orange-950">
                <h4 className="font-bold text-sm mb-1">
                  Deploying to AWS Cloud (App Runner or ECS)
                </h4>
                <p className="text-xs leading-relaxed">
                  A multi-stage production <code className="bg-orange-100 px-1 py-0.5 rounded font-mono">Dockerfile</code> and NGINX reverse proxy config are pre-built in the project root.
                </p>
              </div>

              <div>
                <span className="font-bold text-slate-700 block mb-1">
                  Step 1: Build Docker Container
                </span>
                <div className="relative bg-slate-900 text-slate-200 p-3 rounded-xl font-mono text-xs">
                  <div>docker build -t aman-label-printer:latest .</div>
                  <button
                    onClick={() => copyCode('aws-docker', 'docker build -t aman-label-printer:latest .\ndocker run -p 3000:80 aman-label-printer:latest')}
                    className="absolute right-2.5 top-2.5 p-1 bg-slate-800 hover:bg-slate-700 rounded text-slate-300"
                  >
                    {copiedKey === 'aws-docker' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>

              <div>
                <span className="font-bold text-slate-700 block mb-1">
                  Step 2: Push to AWS ECR &amp; Deploy to App Runner
                </span>
                <div className="relative bg-slate-900 text-slate-200 p-3 rounded-xl font-mono text-xs">
                  <div># Authenticate with Amazon ECR</div>
                  <div>aws ecr get-login-password --region us-east-1 | docker login ...</div>
                  <div>docker tag aman-label-printer:latest &lt;aws_account_id&gt;.dkr.ecr.us-east-1.amazonaws.com/...</div>
                  <div>docker push ...</div>
                </div>
              </div>
            </div>
          )}

          {activePlatform === 'pwa_mobile' && (
            <div className="space-y-4">
              <div className="p-3.5 bg-blue-50 rounded-xl border border-blue-200 text-blue-950">
                <h4 className="font-bold text-sm mb-1">
                  Install as Mobile Native App (PWA)
                </h4>
                <p className="text-xs leading-relaxed">
                  This web app meets all Progressive Web App (PWA) criteria with standalone display, offline cache, and camera scanner access.
                </p>
              </div>

              <div className="space-y-2">
                <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
                  <div className="font-bold text-slate-800">📱 Android (Chrome / Edge / Samsung)</div>
                  <div className="text-slate-600 mt-1">
                    Tap the <strong>three dots menu (&vellip;)</strong> &rarr; Select <strong>&ldquo;Add to Home screen&rdquo;</strong> or <strong>&ldquo;Install app&rdquo;</strong>.
                  </div>
                </div>

                <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
                  <div className="font-bold text-slate-800">🍏 iOS / iPhone / iPad (Safari)</div>
                  <div className="text-slate-600 mt-1">
                    Tap the <strong>Share button</strong> (square with arrow) &rarr; Scroll down and tap <strong>&ldquo;Add to Home Screen&rdquo;</strong>.
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-slate-200 bg-slate-50 flex justify-end">
          <button
            onClick={onClose}
            className="px-5 py-2 bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs rounded-xl"
          >
            Close Guide
          </button>
        </div>
      </div>
    </div>
  );
};
