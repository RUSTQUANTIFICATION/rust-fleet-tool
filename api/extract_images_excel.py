import os
from openpyxl import load_workbook
from PIL import Image
from io import BytesIO


def extract_images_excel(file_path, output_dir):

    os.makedirs(output_dir, exist_ok=True)

    wb = load_workbook(file_path)

    saved = []

    for sheet in wb.worksheets:

        for image in sheet._images:

            img_bytes = image._data()

            img = Image.open(BytesIO(img_bytes))

            name = f"{sheet.title}_{len(saved)}.jpg"

            path = os.path.join(output_dir, name)

            img.save(path)

            saved.append(path)

    return saved