const robot = require("robotjs");

const screenSize = robot.getScreenSize();

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function moveRandom() {
    while (true) {
        const randomX = Math.floor(Math.random() * screenSize.width);
        const randomY = Math.floor(Math.random() * screenSize.height);

        robot.moveMouseSmooth(randomX, randomY, 1.0);
        console.log(`Movido a: ${randomX}, ${randomY}`);

        await sleep(2000); // espera 2 segundos
    }
}

async function trackMousePosition() {
    let lastPosition = robot.getMousePos();

    while (true) {
        const currentPosition = robot.getMousePos();

        if (
            currentPosition.x !== lastPosition.x ||
            currentPosition.y !== lastPosition.y
        ) {
            console.log(`Mouse movido a: X=${currentPosition.x}, Y=${currentPosition.y}`);
            lastPosition = currentPosition;
        }

        await sleep(250); // chequea cada 50ms
    }
}

moveRandom();
trackMousePosition();
