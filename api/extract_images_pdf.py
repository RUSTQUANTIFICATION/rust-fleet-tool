import fitz
import os


def extract_images_pdf(file_path, output_dir):

    os.makedirs(output_dir, exist_ok=True)

    saved = []

    doc = fitz.open(file_path)

    for page_index in range(len(doc)):

        page = doc[page_index]

        images = page.get_images(full=True)

        for img_index, img in enumerate(images):

            xref = img[0]

            base = doc.extract_image(xref)

            image_bytes = base["image"]

            name = f"page{page_index}_{img_index}.jpg"

            path = os.path.join(output_dir, name)

            with open(path, "wb") as f:
                f.write(image_bytes)

            saved.append(path)

    return saved