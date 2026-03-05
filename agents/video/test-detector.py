from azure.cognitiveservices.vision.customvision.prediction import CustomVisionPredictionClient
from msrest.authentication import ApiKeyCredentials
from matplotlib import pyplot as plt
from PIL import Image, ImageDraw, ImageFont
import numpy as np
import os

def main():
    from dotenv import load_dotenv

    os.system('cls' if os.name=='nt' else 'clear')

    try:
        load_dotenv()
        prediction_endpoint = os.getenv('PredictionEndpoint')
        prediction_key = os.getenv('PredictionKey')
        project_id = os.getenv('ProjectID')
        model_name = os.getenv('ModelName', 'fruit-detector')

        credentials = ApiKeyCredentials(in_headers={"Prediction-key": prediction_key})
        prediction_client = CustomVisionPredictionClient(prediction_endpoint, credentials)

        image_file = 'produce.jpg'
        print('Detecting objects in', image_file)

        with open(image_file, mode="rb") as image_data:
            results = prediction_client.detect_image(project_id, model_name, image_data)

        fig = plt.figure(figsize=(8, 8))
        plt.axis('off')
        image = Image.open(image_file)
        draw = ImageDraw.Draw(image)
        lineWidth = int(image.width / 100)

        color_map = {
            'apple': 'red',
            'banana': 'yellow',
            'orange': 'orange'
        }

        for prediction in results.predictions:
            if prediction.probability > 0.5:
                left = prediction.bounding_box.left * image.width
                top = prediction.bounding_box.top * image.height
                width = prediction.bounding_box.width * image.width
                height = prediction.bounding_box.height * image.height

                color = color_map.get(prediction.tag_name, 'green')

                points = [
                    (left, top),
                    (left + width, top),
                    (left + width, top + height),
                    (left, top + height),
                    (left, top)
                ]
                draw.line(points, fill=color, width=lineWidth)

                label = f"{prediction.tag_name} ({prediction.probability*100:.1f}%)"
                draw.text((left + lineWidth, top + lineWidth), label, fill=color)

                print(f"\t{prediction.tag_name}: {prediction.probability*100:.1f}% "
                      f"[{left:.0f},{top:.0f} - {left+width:.0f},{top+height:.0f}]")

        plt.imshow(image)
        plt.tight_layout(pad=0)
        outputfile = 'output.jpg'
        fig.savefig(outputfile)
        print(f'Results saved in {outputfile}')

    except Exception as ex:
        print(ex)

if __name__ == "__main__":
    main()
