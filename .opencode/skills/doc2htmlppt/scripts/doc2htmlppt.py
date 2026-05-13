#!/usr/bin/env python3
"""
文档转HTML幻灯片工具
用法:
    python doc2htmlppt.py <文档路径或飞书链接> [--output OUTPUT.html] [--no-interactive]
"""

import os
import sys
import re
import json
import argparse
import urllib.request
from pathlib import Path
from typing import Dict, List, Optional, Tuple, Any

# 获取脚本所在目录，以便定位资源文件
SCRIPT_DIR = Path(__file__).parent.absolute()
SKILL_DIR = SCRIPT_DIR.parent
ASSETS_DIR = SKILL_DIR / "assets"
TEMPLATE_FILE = ASSETS_DIR / "templates" / "base.html"
PALETTES_FILE = ASSETS_DIR / "colors" / "palettes.json"

# ===================== 文档内容提取模块 =====================
def extract_from_feilishu(url: str) -> str:
    """
    从飞书公开链接提取文本内容（模拟实现，实际可能需要API）
    提示用户手动粘贴内容。
    """
    print(f"检测到飞书链接: {url}")
    print("由于飞书API需要授权，请手动将文档内容复制粘贴到下面（输入完成后按Ctrl+D或输入END结束）：")
    lines = []
    while True:
        try:
            line = input()
            if line.strip() == "END":
                break
            lines.append(line)
        except EOFError:
            break
    return "\n".join(lines)

def extract_from_file(filepath: str) -> str:
    """从本地文件读取文本"""
    path = Path(filepath)
    if not path.exists():
        raise FileNotFoundError(f"文件不存在: {filepath}")
    return path.read_text(encoding='utf-8')

def extract_from_url(url: str) -> str:
    """从普通URL获取文本内容（简单提取）"""
    try:
        with urllib.request.urlopen(url) as response:
            html = response.read().decode('utf-8')
            # 简单的文本提取（去除HTML标签）
            text = re.sub(r'<[^>]+>', ' ', html)
            text = re.sub(r'\s+', ' ', text).strip()
            return text
    except Exception as e:
        print(f"无法从URL获取内容: {e}")
        return ""

# ===================== 交互式提问模块 =====================
def ask_questions(document_text: str, interactive: bool = True) -> Dict:
    """
    基于文档内容向用户提问，返回需求字典
    如果 interactive=False，则使用默认值（适合脚本批量测试）
    """
    if not interactive:
        return {
            "purpose": "内部汇报",
            "audience": "管理层",
            "key_points": ["核心点1", "核心点2", "核心点3"],
            "summarize": "是",
            "must_include": "无",
            "page_count": "8",
            "pagination": "固定页数",
            "style": "大字少话",
            "color": "科技蓝",
            "color_forbidden": "无",
            "effect_transition": "淡入淡出",
            "effect_other": "无",
            "golden_sentence": "是",
            "has_chart": "否",
            "duration": "15",
            "concern": "核心成果"
        }

    print("\n" + "="*50)
    print("请回答以下问题，以便生成最合适的HTML幻灯片：")
    print("="*50 + "\n")

    # 分析文档片段，提供一些上下文
    preview = document_text[:500].replace('\n', ' ')
    print(f"文档预览：{preview}...\n")

    questions = {
        "purpose": "这份材料主要用于什么场景？（内部汇报、客户提案、产品发布、培训等）",
        "audience": "目标听众是谁？（管理层、技术团队、客户、投资人等）",
        "key_points": "最想让听众记住的3个核心点是什么？（用逗号分隔）",
        "summarize": "是否需要对原始内容进行提炼和总结？（是/否）",
        "must_include": "有没有必须放的内容或数据？（如具体图表、原文、参数等，若无则填无）",
        "page_count": "希望的PPT大致页数？（如8-10页）",
        "pagination": "每页内容展示方式：'自适应分页'（根据内容多少自动调整）还是 '固定页数'（按指定页数均匀分配）？",
        "style": "每页风格倾向：'大字少话（演讲者补充）' 还是 '内容详细（自解释型）'？",
        "color": "主配色是什么？（例如：科技蓝、生态绿、简约黑白、或直接提供色值如#3b82f6）",
        "color_forbidden": "是否有配色禁忌？（如避免红绿搭配，若无则填无）",
        "effect_transition": "是否需要翻页过渡特效？（是/否，若需要可选：淡入淡出、滑动、缩放等）",
        "effect_other": "是否需要其他特效？（如文字动画、背景视差等，若无则填无）",
        "golden_sentence": "是否需要一页'金句总结'升华结尾？（是/否）",
        "has_chart": "文档中是否包含需要可视化展示的数据？（是/否，若'是'请稍后说明具体数据项）",
        "duration": "预计汇报时长？（分钟）",
        "concern": "听众最关心什么？（一句话概括）"
    }

    answers = {}
    for key, question in questions.items():
        while True:
            ans = input(f"{question}\n> ").strip()
            if key == "key_points" and ans:
                answers[key] = [p.strip() for p in ans.split(',') if p.strip()]
                break
            elif key in ["summarize", "golden_sentence", "has_chart"] and ans.lower() not in ['是', '否', 'y', 'n']:
                print("请回答'是'或'否'")
                continue
            elif key == "effect_transition":
                if ans.lower() in ['是', '否', 'y', 'n']:
                    if ans.lower() in ['是', 'y']:
                        answers[key] = "淡入淡出"  # 默认特效
                    else:
                        answers[key] = "无"
                    break
                else:
                    # 用户直接指定特效类型
                    answers[key] = ans
                    break
            elif ans or key == "must_include":
                answers[key] = ans
                break
            else:
                print("请输入回答")
    return answers

# ===================== 内容处理模块 =====================
def summarize_content(document_text: str, key_points: List[str]) -> List[str]:
    """提炼内容，生成要点列表（简单实现）"""
    # 按段落分割，提取包含关键字的段落
    paragraphs = [p.strip() for p in document_text.split('\n') if p.strip()]
    # 简单选取前几个段落作为内容，实际可更智能
    return paragraphs[:10]  # 简化

def paginate_content(paragraphs: List[str], page_count: int, pagination_type: str) -> List[List[str]]:
    """根据分页策略将段落分组"""
    if pagination_type == "自适应分页":
        # 自适应：每个页面最多容纳一定行数（这里简单按段落数均分，但实际可根据字符数）
        # 这里简化：每页最多3段
        pages = []
        page = []
        for para in paragraphs:
            page.append(para)
            if len(page) >= 3:
                pages.append(page)
                page = []
        if page:
            pages.append(page)
        return pages
    else:
        # 固定页数：平均分配
        if not paragraphs:
            return []
        chunk_size = max(1, len(paragraphs) // page_count)
        pages = [paragraphs[i:i+chunk_size] for i in range(0, len(paragraphs), chunk_size)]
        return pages[:page_count]

# ===================== HTML生成模块 =====================
def load_template() -> str:
    """加载HTML基础模板"""
    if TEMPLATE_FILE.exists():
        return TEMPLATE_FILE.read_text(encoding='utf-8')
    else:
        # 后备模板（简化版）
        return """
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>{{title}}</title>
    <style>
        /* 基础样式 */
        :root {
            --bg-color: #ffffff;
            --text-color: #333333;
            --accent-color: #3b82f6;
        }
        /* ... */
    </style>
</head>
<body>
    <div class="slides-container" id="slidesContainer">
        <!-- slides will be injected -->
    </div>
    <script>
        // 基础翻页逻辑
    </script>
</body>
</html>
"""

def load_palettes() -> Dict:
    """加载预设配色"""
    if PALETTES_FILE.exists():
        return json.loads(PALETTES_FILE.read_text(encoding='utf-8'))
    else:
        # 默认配色
        return {
            "科技蓝": {"primary": "#0a66c2", "secondary": "#e6f0ff", "bg": "#ffffff", "text": "#1f2937"},
            "生态绿": {"primary": "#2e7d32", "secondary": "#e8f5e9", "bg": "#ffffff", "text": "#1f2937"},
            "简约黑白": {"primary": "#000000", "secondary": "#f5f5f5", "bg": "#ffffff", "text": "#333333"}
        }

def generate_html(document_text: str, answers: Dict, output_file: str):
    """生成最终的HTML文件"""
    # 加载模板和配色
    template = load_template()
    palettes = load_palettes()
    color_key = answers.get("color", "科技蓝")
    if color_key in palettes:
        colors = palettes[color_key]
    else:
        # 可能是自定义色值
        colors = {
            "primary": color_key,
            "secondary": "#f0f0f0",
            "bg": "#ffffff",
            "text": "#1f2937"
        }

    # 处理内容
    if answers.get("summarize") == "是":
        paragraphs = summarize_content(document_text, answers.get("key_points", []))
    else:
        paragraphs = [p.strip() for p in document_text.split('\n') if p.strip()]

    # 分页
    try:
        page_count = int(re.search(r'\d+', answers.get("page_count", "8"))[0])
    except:
        page_count = 8
    pagination_type = answers.get("pagination", "固定页数")
    content_pages = paginate_content(paragraphs, page_count, pagination_type)

    # 构建幻灯片列表
    slides = []

    # 封面页
    slides.append({
        "type": "cover",
        "title": "演示文稿",  # 可从文档首行提取
        "subtitle": answers.get("purpose", "")
    })

    # 目录页（如果页数较多）
    if page_count > 5:
        slides.append({
            "type": "toc",
            "items": ["核心要点", "主要内容", "数据与洞察", "总结"]
        })

    # 内容页
    for i, page_paras in enumerate(content_pages):
        slides.append({
            "type": "content",
            "title": f"第{i+1}部分",
            "content": page_paras,
            "is_big_text": answers.get("style", "").find("大字") != -1
        })

    # 金句页
    if answers.get("golden_sentence") == "是":
        slides.append({
            "type": "golden",
            "text": "砥砺前行，共创未来"  # 默认
        })

    # 生成CSS特效
    transition_effect = answers.get("effect_transition", "无")
    transition_css = ""
    if transition_effect == "淡入淡出":
        transition_css = "transition: opacity 0.5s ease;"
    elif transition_effect == "滑动":
        transition_css = "transition: transform 0.5s ease; transform: translateX(0);"
    elif transition_effect == "缩放":
        transition_css = "transition: transform 0.5s ease, opacity 0.5s ease; transform: scale(1);"
    else:
        transition_css = "transition: opacity 0.3s ease;"

    # 构建完整的HTML（此处简化，实际应替换模板中的占位符）
    html = f"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=yes">
    <title>HTML幻灯片 - {answers.get('purpose', '演示文稿')}</title>
    <style>
        :root {{
            --bg-color: {colors["bg"]};
            --text-color: {colors["text"]};
            --accent-color: {colors["primary"]};
            --secondary-bg: {colors["secondary"]};
            --heading-color: {colors["primary"]};
            --nav-bg: rgba(255,255,255,0.9);
        }}
        * {{ margin: 0; padding: 0; box-sizing: border-box; }}
        body {{
            font-family: 'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
            background: var(--bg-color);
            color: var(--text-color);
            overflow: hidden;
            height: 100vh;
        }}
        .slides-container {{
            height: 100%;
            width: 100%;
            position: relative;
        }}
        .slide {{
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            opacity: 0;
            visibility: hidden;
            {transition_css}
            overflow-y: auto;
            padding: 3rem 4rem;
            display: flex;
            flex-direction: column;
            justify-content: center;
        }}
        .slide.active {{
            opacity: 1;
            visibility: visible;
        }}
        h1 {{ font-size: 3.5rem; margin-bottom: 1rem; color: var(--heading-color); font-weight: 700; }}
        h2 {{ font-size: 2.5rem; margin-bottom: 1rem; color: var(--heading-color); border-left: 5px solid var(--accent-color); padding-left: 1rem; }}
        p, li {{ font-size: {"1.8rem" if slides[2].get('is_big_text', False) else "1.25rem"}; line-height: 1.5; margin-bottom: 0.5rem; }}
        .golden {{ text-align: center; font-size: 3rem; font-weight: bold; color: var(--accent-color); }}
        .nav-btn {{
            position: fixed; top: 50%; transform: translateY(-50%);
            background: var(--nav-bg); border: none; font-size: 2rem; cursor: pointer;
            padding: 0.5rem 1rem; border-radius: 0.5rem; backdrop-filter: blur(4px);
            z-index: 100; box-shadow: 0 2px 8px rgba(0,0,0,0.1);
        }}
        .prev {{ left: 1rem; }} .next {{ right: 1rem; }}
        .page-indicator {{
            position: fixed; bottom: 1rem; left: 50%; transform: translateX(-50%);
            background: rgba(0,0,0,0.6); color: white; padding: 0.3rem 0.8rem;
            border-radius: 2rem; font-size: 0.9rem; z-index: 100;
        }}
        @media (max-width: 768px) {{
            .slide {{ padding: 2rem 1.5rem; }}
            h1 {{ font-size: 2rem; }}
            h2 {{ font-size: 1.8rem; }}
            p, li {{ font-size: {"1.2rem" if slides[2].get('is_big_text', False) else "1rem"}; }}
            .golden {{ font-size: 2rem; }}
            .nav-btn {{ font-size: 1.5rem; }}
        }}
    </style>
</head>
<body>
<div class="slides-container" id="slidesContainer">
"""
    # 动态添加幻灯片
    for i, slide in enumerate(slides):
        active = "active" if i == 0 else ""
        html += f'<div class="slide {active}" id="slide_{i}">\n'
        if slide["type"] == "cover":
            html += f'<h1>{slide["title"]}</h1>\n'
            if slide.get("subtitle"):
                html += f'<p style="font-size: 1.8rem;">{slide["subtitle"]}</p>\n'
        elif slide["type"] == "toc":
            html += '<h2>目录</h2>\n<ul>\n'
            for item in slide["items"]:
                html += f'<li>{item}</li>\n'
            html += '</ul>\n'
        elif slide["type"] == "content":
            html += f'<h2>{slide["title"]}</h2>\n'
            for para in slide["content"]:
                if para.strip():
                    html += f'<p>{para}</p>\n'
        elif slide["type"] == "golden":
            html += f'<div class="golden">{slide["text"]}</div>\n'
        html += '</div>\n'

    # 导航和脚本
    html += f"""
</div>
<button class="nav-btn prev" id="prevBtn">❮</button>
<button class="nav-btn next" id="nextBtn">❯</button>
<div class="page-indicator" id="pageIndicator">1 / {len(slides)}</div>
<script>
    let currentSlide = 0;
    const slides = document.querySelectorAll('.slide');
    const totalSlides = slides.length;
    const prevBtn = document.getElementById('prevBtn');
    const nextBtn = document.getElementById('nextBtn');
    const indicator = document.getElementById('pageIndicator');

    function updateSlides() {{
        slides.forEach((slide, idx) => {{
            if (idx === currentSlide) {{
                slide.classList.add('active');
            }} else {{
                slide.classList.remove('active');
            }}
        }});
        indicator.innerText = `${{currentSlide + 1}} / ${{totalSlides}}`;
    }}

    function nextSlide() {{ if (currentSlide < totalSlides - 1) {{ currentSlide++; updateSlides(); }} }}
    function prevSlide() {{ if (currentSlide > 0) {{ currentSlide--; updateSlides(); }} }}
    prevBtn.addEventListener('click', prevSlide);
    nextBtn.addEventListener('click', nextSlide);
    window.addEventListener('keydown', (e) => {{
        if (e.key === 'ArrowLeft') prevSlide();
        if (e.key === 'ArrowRight') nextSlide();
    }});
    let touchStartX = 0;
    document.body.addEventListener('touchstart', (e) => {{ touchStartX = e.changedTouches[0].screenX; }});
    document.body.addEventListener('touchend', (e) => {{
        const endX = e.changedTouches[0].screenX;
        if (endX < touchStartX - 50) nextSlide();
        if (endX > touchStartX + 50) prevSlide();
    }});
</script>
</body>
</html>
"""
    # 写入文件
    Path(output_file).write_text(html, encoding='utf-8')
    print(f"\n✅ HTML幻灯片已生成: {output_file}")

# ===================== 主函数 =====================
def main():
    parser = argparse.ArgumentParser(description="将文档转换为HTML幻灯片")
    parser.add_argument("source", help="文档来源：飞书链接或本地文件路径")
    parser.add_argument("-o", "--output", default="output.html", help="输出HTML文件名")
    parser.add_argument("--no-interactive", action="store_true", help="使用默认值，不进行交互提问")
    args = parser.parse_args()

    # 获取文档内容
    source = args.source
    if source.startswith("http://") or source.startswith("https://"):
        if "feishu.cn" in source:
            content = extract_from_feilishu(source)
        else:
            content = extract_from_url(source)
    else:
        content = extract_from_file(source)

    if not content:
        print("错误：无法获取文档内容，请检查输入。")
        sys.exit(1)

    # 提问
    answers = ask_questions(content, interactive=not args.no_interactive)

    # 生成HTML
    generate_html(content, answers, args.output)

if __name__ == "__main__":
    main()