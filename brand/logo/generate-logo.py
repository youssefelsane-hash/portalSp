"""مولّد هوية OSTA — كل الأشكال محسوبة هندسيًا، مفيش رقم متحطّ بالنظر."""
import math

NAVY   = "#14171f"
BLUE   = "#2f5aa6"
BLUE_D = "#24467f"   # ظل التدرّج
GOLD   = "#c98a1f"
WHITE  = "#ffffff"

# ─────────────────────────────────────────────────────────────────────────────
# الرمز: دايرة خارجية مثالية + مسدّس داخلي مدوّر الأركان (صامولة = حرفة، ختم = ثقة)
# ─────────────────────────────────────────────────────────────────────────────
def rounded_hexagon(cx, cy, R, corner):
    """مسدّس flat-top بأركان مدوّرة — الرؤوس على 0°,60°,...,300°."""
    pts = [(cx + R*math.cos(math.radians(a)), cy - R*math.sin(math.radians(a)))
           for a in range(0, 360, 60)]
    n = len(pts)
    d = []
    for i in range(n):
        p    = pts[i]
        prev = pts[(i-1) % n]
        nxt  = pts[(i+1) % n]
        # نقطة الدخول والخروج على بُعد `corner` من الركن على كل ضلع
        def along(a, b, dist):
            vx, vy = b[0]-a[0], b[1]-a[1]
            L = math.hypot(vx, vy)
            return (a[0] + vx/L*dist, a[1] + vy/L*dist)
        entry = along(p, prev, corner)
        exit_ = along(p, nxt,  corner)
        if i == 0:
            d.append(f"M {entry[0]:.3f} {entry[1]:.3f}")
        else:
            d.append(f"L {entry[0]:.3f} {entry[1]:.3f}")
        d.append(f"Q {p[0]:.3f} {p[1]:.3f} {exit_[0]:.3f} {exit_[1]:.3f}")
    d.append("Z")
    return " ".join(d)

MARK_R_OUT = 46.0
MARK_HEX_R = 29.5
MARK_HEX_C = 6.0

def mark_path():
    outer = (f"M 50 {50-MARK_R_OUT} A {MARK_R_OUT} {MARK_R_OUT} 0 1 1 49.99 {50-MARK_R_OUT} Z")
    return outer + " " + rounded_hexagon(50, 50, MARK_HEX_R, MARK_HEX_C)

# ─────────────────────────────────────────────────────────────────────────────
# الـwordmark: خطوط هندسية أحادية السُمك، كله مسارات (مفيش اعتماد على خط)
# ─────────────────────────────────────────────────────────────────────────────
H = 60.0           # ارتفاع الحرف الكبير
W = 10.0           # سُمك الخط
HW = W/2

TERM = 42.0   # زاوية إنهاء طرف الـS — بتتحكّم في «فتحة» الحرف

def s_path(x0):
    """S من قوسين دائريين متساويين (٢٣٠° لكل واحد) — البناء الهندسي الكلاسيكي.

    **الرقم ده هو كل الفرق**: أول نسخة كانت بتبدأ من -35° فالقوس بقى ٣٠٥° — يعني
    فتحة ٥٥° بس، والحرف بيتقرا «8» مقفولة. البداية فوق الأفقي (+42°) بتدّي فتحة
    حقيقية والحرف بيبان S.
    """
    r  = (H - W)/4
    cx = x0 + (2*r + W)/2
    top_c = (cx, HW + r)
    bot_c = (cx, H - HW - r)
    def pt(c, deg):
        return (c[0] + r*math.cos(math.radians(deg)), c[1] - r*math.sin(math.radians(deg)))
    p0 = pt(top_c, TERM)            # الطرف العلوي، فوق يمين
    p1 = pt(top_c, 270)             # نقطة الالتقاء = أسفل الدايرة العليا
    p2 = pt(bot_c, 180 + TERM)      # الطرف السفلي، تحت شمال
    return (f"M {p0[0]:.3f} {p0[1]:.3f} "
            f"A {r:.3f} {r:.3f} 0 1 0 {p1[0]:.3f} {p1[1]:.3f} "
            f"A {r:.3f} {r:.3f} 0 1 1 {p2[0]:.3f} {p2[1]:.3f}")

S_W = 2*((H-W)/4) + W
T_W = 38.0
A_W = 46.0
# **تباعد بصري مش ميكانيكي**: الحروف الدايرية (O، S) بتاكل مسافة من جوّاها فمحتاجة
# فراغ أقل، والـT بعارضتها الناتئة مع الـA المايلة بيعملوا فجوة وهمية فوق فمحتاجين
# تقارب أكتر. رقم واحد لكل الأزواج بيبان غلط للعين حتى لو صح بالمسطرة.
GAP_OS = 12.0
GAP_ST = 11.0
GAP_TA = 5.0
O_W = 60.0

def wordmark_group(fill, x=0.0, y=0.0):
    """O (الرمز) + S + T + A — بترجّع (svg, العرض الكلي)."""
    parts = []
    cur = x
    # O = الرمز نفسه، متسكّل لارتفاع الحرف
    # **overshoot بصري**: الشكل الدائري بنفس ارتفاع الحرف المسطّح بيبان أصغر منه للعين،
    # فبيتعمله زيادة ~٢.٥٪ فوق وتحت. ده تصحيح طباعي معتاد مش رقم عشوائي.
    OVER = 1.5
    o_h = O_W + 2*OVER
    scale = o_h / (2*MARK_R_OUT)
    parts.append(
        f'<g transform="translate({cur:.3f} {y - OVER:.3f}) scale({scale:.5f}) translate({-(50-MARK_R_OUT):.3f} {-(50-MARK_R_OUT):.3f})">'
        f'<path d="{mark_path()}" fill="{fill}" fill-rule="evenodd"/></g>'
    )
    cur += o_h + GAP_OS
    stroke = f'fill="none" stroke="{fill}" stroke-width="{W}" stroke-linecap="round" stroke-linejoin="round"'
    # S
    parts.append(f'<g transform="translate(0 {y:.3f})"><path d="{s_path(cur)}" {stroke}/></g>')
    cur += S_W + GAP_ST
    # T
    tx = cur
    parts.append(f'<g transform="translate(0 {y:.3f})">'
                 f'<path d="M {tx+HW:.3f} {HW} L {tx+T_W-HW:.3f} {HW}" {stroke}/>'
                 f'<path d="M {tx+T_W/2:.3f} {HW} L {tx+T_W/2:.3f} {H-HW}" {stroke}/></g>')
    cur += T_W + GAP_TA
    # A
    ax = cur
    # قمة **مسطّحة** بعرض سُمك الخط بدل سن حاد: السن الحاد في خط أحادي السُمك بيتكتّل
    # حبر وبيبان تقيل، والقمة المسطّحة هي الحل الطباعي المعتاد.
    apex_l = (ax + A_W/2 - W*0.30, HW)
    apex_r = (ax + A_W/2 + W*0.30, HW)
    lfoot = (ax + HW, H - HW)
    rfoot = (ax + A_W - HW, H - HW)
    bar_y = 41.0
    t = (lfoot[1] - bar_y) / (lfoot[1] - apex_l[1])
    bar_lx = lfoot[0] + t*(apex_l[0] - lfoot[0])
    bar_rx = rfoot[0] + t*(apex_r[0] - rfoot[0])
    parts.append(f'<g transform="translate(0 {y:.3f})">'
                 f'<path d="M {lfoot[0]:.3f} {lfoot[1]:.3f} L {apex_l[0]:.3f} {apex_l[1]:.3f} '
                 f'L {apex_r[0]:.3f} {apex_r[1]:.3f} L {rfoot[0]:.3f} {rfoot[1]:.3f}" {stroke}/>'
                 f'<path d="M {bar_lx:.3f} {bar_y} L {bar_rx:.3f} {bar_y}" {stroke}/></g>')
    cur += A_W
    return "".join(parts), cur - x

def svg(w, h, body, extra=""):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w:g} {h:g}" '
            f'width="{w:g}" height="{h:g}" role="img">{extra}{body}</svg>')

import sys, os
out = sys.argv[1]
os.makedirs(out, exist_ok=True)

# ١) الرمز لوحده
open(f"{out}/osta-mark.svg","w").write(
    svg(100, 100, f'<path d="{mark_path()}" fill="{BLUE}" fill-rule="evenodd"/>'))

# ٢) اللوجو الأساسي (أفقي)
body, total = wordmark_group(NAVY)
open(f"{out}/osta-logo.svg","w").write(svg(round(total,2), 60, body))

# ٣) نسخة كلها أزرق
body_b, _ = wordmark_group(BLUE)
open(f"{out}/osta-logo-blue.svg","w").write(svg(round(total,2), 60, body_b))

# ٤) نسخة للخلفية الغامقة
body_w, _ = wordmark_group(WHITE)
open(f"{out}/osta-logo-white.svg","w").write(svg(round(total,2), 60, body_w))

print(f"العرض الكلي للّوجو = {total:.2f} × 60")
print(f"S_W={S_W:.2f}")

# ─────────────────────────────────────────────────────────────────────────────
# أيقونة التطبيق — مشتقّة من نفس الرمز بالحرف، مفيش شكل تاني
# ─────────────────────────────────────────────────────────────────────────────
def icon_svg(bg_top, bg_bot, fg, size=1024, mark_ratio=0.58, rounded=None, grad_id="g"):
    """
    `mark_ratio` = عرض الرمز ÷ عرض الأيقونة.

    ٠.٥٨ مش رقم ذوق: منطقة الأمان في أيقونة Android القابلة للقص (maskable) هي الدايرة
    المركزية بقطر ٨٠٪، وأي حاجة برّاها ممكن النظام يقصّها. ٥٨٪ بتسيب هامش حقيقي جوّه
    الدايرة دي، وفي نفس الوقت بتدّي الرمز الوزن البصري اللي توصية Apple/Google بتقوله
    (~٦٠٪ من الكانفاس) بدل رمز تايه في النص.
    """
    m = size * mark_ratio
    off = (size - m) / 2
    scale = m / 100.0
    shape = (f'<rect width="{size}" height="{size}" rx="{rounded}" fill="url(#{grad_id})"/>'
             if rounded else f'<rect width="{size}" height="{size}" fill="url(#{grad_id})"/>')
    defs = (f'<defs><linearGradient id="{grad_id}" x1="0" y1="0" x2="1" y2="1">'
            f'<stop offset="0" stop-color="{bg_top}"/><stop offset="1" stop-color="{bg_bot}"/>'
            f'</linearGradient></defs>')
    body = (shape +
            f'<g transform="translate({off:.2f} {off:.2f}) scale({scale:.5f})">'
            f'<path d="{mark_path()}" fill="{fg}" fill-rule="evenodd"/></g>')
    return svg(size, size, body, defs)

BLUE_HI = "#3d6fc4"
NAVY_D  = "#1b3companion"  # placeholder — بيتستبدل تحت
NAVY_D  = "#1b3564"

# مربع كامل (iOS بيحط الماسك بنفسه)
open(f"{out}/osta-icon.svg","w").write(icon_svg(BLUE_HI, NAVY_D, WHITE, 1024, 0.58, None, "gi"))
# مربع بأركان مدوّرة — للعرض والويب
open(f"{out}/osta-icon-rounded.svg","w").write(icon_svg(BLUE_HI, NAVY_D, WHITE, 1024, 0.58, 224, "gr"))
# طبقة المقدّمة لأيقونة أندرويد التكيّفية (خلفية منفصلة)
open(f"{out}/osta-icon-foreground.svg","w").write(
    svg(1024, 1024, f'<g transform="translate({(1024-1024*0.42)/2:.2f} {(1024-1024*0.42)/2:.2f}) scale({1024*0.42/100:.5f})">'
                    f'<path d="{mark_path()}" fill="{WHITE}" fill-rule="evenodd"/></g>'))
open(f"{out}/osta-icon-background.svg","w").write(
    svg(1024, 1024, '<rect width="1024" height="1024" fill="url(#gb)"/>',
        f'<defs><linearGradient id="gb" x1="0" y1="0" x2="1" y2="1">'
        f'<stop offset="0" stop-color="{BLUE_HI}"/><stop offset="1" stop-color="{NAVY_D}"/></linearGradient></defs>'))
# نسخة فاتحة
open(f"{out}/osta-icon-light.svg","w").write(icon_svg("#ffffff", "#eef1f6", BLUE, 1024, 0.58, 224, "gl"))
print("icons OK")
