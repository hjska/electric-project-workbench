"""
生成应用图标 build/icon.ico
设计：蓝色渐变圆角底 + 白色闪电（电气）+ 底部三栏进度条（项目管理）
采用 4 倍超采样绘制后降采样，保证各尺寸边缘平滑。
"""
from PIL import Image, ImageDraw
import os

OUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'build')
os.makedirs(OUT_DIR, exist_ok=True)

SS = 4                 # 超采样倍数
SIZE = 1024
S = SIZE * SS

# 配色
C_TOP = (58, 130, 255)     # 亮蓝
C_BOT = (12, 62, 190)      # 深蓝
WHITE = (255, 255, 255, 255)


def lerp(a, b, t):
    return tuple(int(round(a[i] + (b[i] - a[i]) * t)) for i in range(3))


def rounded_mask(size, radius):
    m = Image.new('L', (size, size), 0)
    d = ImageDraw.Draw(m)
    d.rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=255)
    return m


def make_gradient(size):
    img = Image.new('RGB', (size, size))
    d = ImageDraw.Draw(img)
    for y in range(size):
        d.line([(0, y), (size, y)], fill=lerp(C_TOP, C_BOT, y / (size - 1)))
    return img


def build():
    # 1) 渐变底 + 圆角
    base = make_gradient(S)
    mask = rounded_mask(S, radius=int(S * 0.235))
    img = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    img.paste(base, (0, 0), mask)

    d = ImageDraw.Draw(img, 'RGBA')

    # 2) 左上角柔光高光
    glow = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    gd.ellipse([-S * 0.35, -S * 0.5, S * 0.85, S * 0.55], fill=(255, 255, 255, 46))
    img.alpha_composite(Image.composite(
        glow, Image.new('RGBA', (S, S), (0, 0, 0, 0)), mask))

    # 3) 白色闪电（居中偏上，底部不侵入进度条区域）
    #    坐标基于 0..1 归一化，便于缩放
    bolt = [
        (0.560, 0.095),
        (0.300, 0.405),
        (0.462, 0.405),
        (0.398, 0.655),
        (0.700, 0.330),
        (0.520, 0.330),
        (0.618, 0.095),
    ]
    pts = [(x * S, y * S) for (x, y) in bolt]
    d.polygon(pts, fill=WHITE)

    # 4) 底部三条进度条（项目管理语义），越靠下越长
    bar_box_x0 = 0.300
    bar_box_w = 0.400
    bar_h = 0.045
    gap = 0.027
    top = 0.752
    ratios = (0.58, 0.79, 1.0)
    for i, r in enumerate(ratios):
        y0 = (top + i * (bar_h + gap)) * S
        y1 = y0 + bar_h * S
        x0 = bar_box_x0 * S
        x1 = (bar_box_x0 + bar_box_w * r) * S
        d.rounded_rectangle([x0, y0, x1, y1], radius=bar_h * S / 2, fill=WHITE)

    # 5) 降采样 + 输出多尺寸 ICO
    final = img.resize((SIZE, SIZE), Image.LANCZOS)

    ico_path = os.path.join(OUT_DIR, 'icon.ico')
    sizes = [(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
    final.save(ico_path, format='ICO', sizes=sizes)

    # 同时留一份 512 PNG 供文档/预览使用
    final.resize((512, 512), Image.LANCZOS).save(
        os.path.join(OUT_DIR, 'icon.png'), format='PNG')

    print('生成:', ico_path)
    print('尺寸:', os.path.getsize(ico_path), 'bytes')


if __name__ == '__main__':
    build()
