# Builds film/soundtrack.wav: an ambient score plus sound design cued to the film timeline.
# Usage: python3 film/sound.py '<marks json>' out.wav
import json, sys, numpy as np
from scipy.signal import butter, sosfilt
SR = 48000
M = json.loads(sys.argv[1])
# Same timeline as film/index.html
CH = [dict(a=M['s1']+.5, b=M['s1_done']+1.8, sp=2.2), dict(a=M['s2'], b=M['s3']-.3, sp=1.15),
      dict(a=M['s3']+2.5, b=M['s3_done']+1.5, sp=1.6), dict(a=M['s4'], b=min(M['end'], M['s4']+9), sp=1.2)]
t0 = 25.2
for c in CH: c['t0'] = t0; c['t1'] = t0 + (c['b']-c['a'])/c['sp']; t0 = c['t1']
END = t0; DUR = END + 6
def ft(i, f): c = CH[i]; return c['t0'] + (f - c['a'])/c['sp']
N = int(DUR*SR); mix = np.zeros((N, 2)); music = np.zeros((N, 2))
rng = np.random.default_rng(7)
def lp(x, fc, o=2): return sosfilt(butter(o, fc, 'low', fs=SR, output='sos'), x)
def hp(x, fc, o=2): return sosfilt(butter(o, fc, 'high', fs=SR, output='sos'), x)
def bp(x, lo, hi): return sosfilt(butter(2, [lo, hi], 'band', fs=SR, output='sos'), x)
def add(buf, t, sig, gain=1.0, pan=0.0):
    i = int(t*SR); 
    if i >= len(buf): return
    sig = sig[:len(buf)-i]
    l, r = np.sqrt((1-pan)/2), np.sqrt((1+pan)/2)
    if sig.ndim == 1: buf[i:i+len(sig), 0] += sig*gain*l*1.414; buf[i:i+len(sig), 1] += sig*gain*r*1.414
    else: buf[i:i+len(sig)] += sig*gain
def env(n, a, d): # attack, then exponential decay (seconds)
    t = np.arange(n)/SR; return np.minimum(t/max(a,1e-4), 1) * np.exp(-np.maximum(t-a, 0)/d)
def hz(m): return 440*2**((m-69)/12)

# ---- score: warm pad (detuned saws, low-passed), tense in the problem, opens up at the reveal ----
def pad(notes, dur, bright):
    n = int(dur*SR); t = np.arange(n)/SR; out = np.zeros((n, 2))
    for k, m in enumerate(notes):
        for det, ch in ((-.07, 0), (.07, 1), (0, 0), (0, 1)):
            f = hz(m) * 2**(det/12)
            ph = rng.random()
            saw = 2*((f*t + ph) % 1) - 1
            out[:, ch] += saw * .5
    out = np.stack([lp(out[:,0], bright, 2), lp(out[:,1], bright, 2)], 1)
    a = np.minimum(t/1.6, 1) * np.minimum((dur - t)/1.6, 1)
    return out * a[:, None] / len(notes)
prog = [  # (start, dur, notes, cutoff)
    (0, 4.8, [38, 50, 53, 57], 700), (4.6, 5.6, [34, 46, 50, 53], 700), (10, 5.8, [36, 48, 51, 55], 800),
    (15.6, 5.6, [33, 45, 48, 52], 650),
    (21, 8, [38, 50, 54, 57, 62], 1600), (28.5, 8, [43, 50, 55, 59], 1500), (36, 8, [40, 52, 55, 59], 1500), (43.5, 8, [45, 52, 57, 61], 1600),
]
s = 51
while s < DUR: 
    for st, nn in ((0, [38, 50, 54, 57, 62]), (7.5, [43, 50, 55, 59]), (15, [40, 52, 55, 59]), (22.5, [45, 52, 57, 61])):
        prog.append((s+st, 8, nn, 1500))
    s += 30
for st, d, nn, fc in prog:
    if st < DUR: add(music, st, pad(nn, min(d, DUR-st+1), fc), .9)
# sub pulse on the beat from the demo on (soft, 96 bpm), heartbeat in the problem section
def kick():
    n = int(.35*SR); t = np.arange(n)/SR; f = 48 + 70*np.exp(-t*30)
    return np.sin(2*np.pi*np.cumsum(f)/SR) * env(n, .002, .12)
beat = 60/96
for k in range(int((DUR-25.2)/beat)):
    tt = 25.2 + k*beat
    if tt < END - .3: add(music, tt, kick(), .5 if k % 2 == 0 else .28)
for tt in np.arange(5.1, 15.4, 1.25): add(music, tt, kick(), .45); add(music, tt+.22, kick(), .25)
# soft hats in the demo
for k in range(int((END-25.2)/(beat/2))):
    tt = 25.2 + k*beat/2 + beat/4
    n = int(.05*SR); add(music, tt, hp(rng.standard_normal(n), 7000)*env(n, .001, .015), .05, .3 if k % 2 else -.3)
# shimmer arpeggio from the reveal
for k, m in enumerate([74, 78, 81, 86, 81, 78]*40):
    tt = 21.2 + k*beat/2
    if tt > END + 5: break
    n = int(.9*SR); t = np.arange(n)/SR
    add(music, tt, np.sin(2*np.pi*hz(m)*t)*env(n, .004, .28)*.5 + np.sin(2*np.pi*hz(m+12)*t)*env(n, .002, .12)*.15, .1, .5 if k % 2 else -.5)
# fade music out at the end
fo = np.ones(N); i0 = int((DUR-3.5)*SR); fo[i0:] = np.linspace(1, 0, N-i0); music *= fo[:, None]

# ---- sound design ----
def whoosh(d=.7, lo=300, hi=4000, rev=False):
    n = int(d*SR); t = np.arange(n)/SR; x = rng.standard_normal(n)
    out = np.zeros(n); seg = 2400
    for i in range(0, n, seg):
        k = i/n; k = 1-k if rev else k
        fc = lo*(hi/lo)**k; out[i:i+seg] = bp(x[i:i+seg], fc*.7, min(fc*1.4, SR/2-100))
    e = np.sin(np.pi*np.minimum(t/d, 1))**2
    return out*e
def impact(): # low boom with a short noise transient
    n = int(1.4*SR); t = np.arange(n)/SR; f = 38 + 90*np.exp(-t*18)
    b = np.sin(2*np.pi*np.cumsum(f)/SR)*env(n, .003, .45)
    nz = lp(rng.standard_normal(n), 1800)*env(n, .001, .05)
    return b + .5*nz
def click():
    n = int(.04*SR); x = bp(rng.standard_normal(n), 1800, 6000)*env(n, .0005, .006)
    return x + .6*np.sin(2*np.pi*2400*np.arange(n)/SR)*env(n, .0005, .004)
def chime(up=True):
    out = np.zeros(int(1.4*SR))
    for k, m in enumerate([76, 83] if up else [71, 64]):
        n = int(1.2*SR); t = np.arange(n)/SR
        tone = (np.sin(2*np.pi*hz(m)*t) + .3*np.sin(2*np.pi*hz(m)*2.01*t) + .1*np.sin(2*np.pi*hz(m)*3*t))*env(n, .003, .35)
        i = int(k*.09*SR); out[i:i+n] += tone[:len(out)-i]
    return out
def deny(): # muted low two-tone, felt not heard
    out = np.zeros(int(.8*SR))
    for k, m in enumerate([50, 45]):
        n = int(.5*SR); t = np.arange(n)/SR
        tone = lp(np.sign(np.sin(2*np.pi*hz(m)*t))*.6, 900)*env(n, .003, .12)
        i = int(k*.12*SR); out[i:i+n] += tone
    return out
def key(): n = int(.03*SR); return bp(rng.standard_normal(n), 2500, 8000)*env(n, .0005, .008)
def riser(d):
    n = int(d*SR); t = np.arange(n)/SR; x = rng.standard_normal(n); out = np.zeros(n); seg = 2400
    for i in range(0, n, seg): fc = 200*(6000/200)**(i/n); out[i:i+seg] = bp(x[i:i+seg], fc*.7, fc*1.3)
    return out*(t/d)**2

for tt in (4.6, 15.6, 25.0): add(mix, tt-.35, whoosh(.8), .35)
add(mix, 19.3, riser(1.7), .25); add(mix, 21.05, impact(), .9); add(mix, 21.1, chime(True), .18)
for tt in (5.1, 8.2, 11.3): add(mix, tt, impact(), .45); add(mix, tt, click(), .3)
for tt in (17.0, 18.3): add(mix, tt, deny(), .3)
for c in CH[1:]: add(mix, c['t0']-.3, whoosh(.6, 400, 5000), .25)
add(mix, END-.3, whoosh(.9, 300, 3000, True), .35); add(mix, END+.15, impact(), .6)
# chapter 1: agent clicks, agent key signs
add(mix, ft(0, M['s1']+3), click(), .5); add(mix, ft(0, M['s1_done']-.3), chime(True), .3)
# chapter 2: hidden text types out, lookalike blocked, airdrop blocked
f = M['s2']+.9
while f < M['s2']+3.0: add(mix, ft(1, f), key(), .18, rng.uniform(-.3, .3)); f += rng.uniform(.03, .07)
add(mix, ft(1, M['s2_pay']+3), impact(), .45); add(mix, ft(1, M['s2_pay']+3), deny(), .35)
add(mix, ft(1, M['s2_claim']), click(), .5); add(mix, ft(1, M['s2_claim']+3), deny(), .35); add(mix, ft(1, M['s2_claim']+3), impact(), .35)
# chapter 3: tip click, approval window, agent denied, human approves, signed
add(mix, ft(2, M['s3']+4), click(), .5); add(mix, ft(2, M['s3']+5.2), whoosh(.45, 800, 6000), .25)
add(mix, ft(2, M['s3_try']+1), deny(), .4)
add(mix, ft(2, M['s3_done']-.9), click(), .5); add(mix, ft(2, M['s3_done']-.4), chime(True), .32)
# chapter 4: swap, refused
add(mix, ft(3, M['s4']+1.6), impact(), .5); add(mix, ft(3, M['s4']+1.6), deny(), .4); add(mix, ft(3, M['s4']+3.2), click(), .3)

out = music*.55 + mix*.9
out = np.stack([hp(out[:,0], 28), hp(out[:,1], 28)], 1)
peak = np.max(np.abs(out)); out = np.tanh(out/peak*1.3)/np.tanh(1.3)*.89
from scipy.io import wavfile
wavfile.write(sys.argv[2], SR, (out*32767).astype(np.int16))
print('duration', round(DUR, 2))
