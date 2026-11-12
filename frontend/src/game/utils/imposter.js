import net from "../../services/net.js";

// The server accepts a kill up to 100 px, measured on ITS copy of the positions. The button lights up
// a little before that (90 px): the server's copy of the target lags what we see by the network delay.
export const KILL_ZONE_RADIUS = 90;

/** Milliseconds before the next kill is allowed (local estimate; the server decides). */
export function killCooldownLeft(scene) {
    return Math.max(0, (scene.killReadyAt || 0) - Date.now());
}

/**
 * Initialize imposter-specific UI and mechanics
 * Sets up kill button, cooldown counter and detection zone for the imposter
 */
export function handleImposter(scene) {
    if (!scene.imposter || !scene.player) return;

    // Kill button click handler
    const handleKill = () => {
        const victim = scene.closest && scene.closest.player;
        // The button is grey in these cases: don't send a request the server would refuse.
        if (!victim || killCooldownLeft(scene) > 0) return;

        // Only a REQUEST: "I want to kill this player". The server knows the killer from our
        // connection, and checks role, distance (with its own positions) and cooldown. If it agrees,
        // everybody gets player:killed (and we jump onto the body then); if not, we get a
        // game:notif refusal, shown as a toast by App.jsx.
        net.emit('player:kill', { playerId: victim.id });

        // Reset closest player tracking
        scene.closest = { player: null, distance: KILL_ZONE_RADIUS };
    };

    // Create kill button UI
    scene.killBtn = scene.add.image(820, 410, 'kill')
        .setScale(0.7)
        .setDepth(1000)
        .setScrollFactor(0)
        .setInteractive()
        .on('pointerdown', handleKill);
    scene.ui.add(scene.killBtn);

    // Seconds left before the next kill, drawn over the button.
    scene.killCooldownText = scene.add.text(820, 410, '', {
        fontFamily: 'Arial Black, Arial',
        fontSize: '44px',
        color: '#ffffff',
        stroke: '#000000',
        strokeThickness: 6,
    }).setOrigin(0.5).setDepth(1001).setScrollFactor(0);
    scene.ui.add(scene.killCooldownText);

    // Create invisible detection zone around imposter
    scene.zone = scene.physics.add.sprite(scene.player.x, scene.player.y, 100, 100);
    if (scene.zone.body) {
        scene.zone.body.setCircle(KILL_ZONE_RADIUS);
        scene.zone.body.setAllowGravity(false);
        scene.zone.visible = false;
    }
}

export function handleImposterMovement(scene) {
    // Update imposter kill zone if player is imposter
    if (scene.imposter && scene.zone && scene.player) {
        scene.zone.setPosition(scene.player.x, scene.player.y);
        handleNearestPlayer(scene);
    }

    if (!scene.killBtn) return;
    const cooldown = killCooldownLeft(scene);
    if (scene.killCooldownText) {
        scene.killCooldownText.setText(cooldown > 0 ? String(Math.ceil(cooldown / 1000)) : '');
    }

    // Grey while no target is in range or the cooldown is running
    const ready = Boolean(scene.closest.player) && cooldown === 0;
    const isGrey = scene.killBtn.pipeline?.name === 'GrayScale';
    if (!ready && !isGrey) scene.killBtn.setPipeline('GrayScale');
    else if (ready && isGrey) scene.killBtn.resetPipeline();
}

/**
 * Track the nearest player within kill range for the imposter
 * Updates scene.closest with the nearest valid target
 */
export function handleNearestPlayer(scene) {
    Object.values(scene.players).forEach(p => {
        // Dead or removed players are not targets (the server would refuse the kill anyway).
        if (!p.alive || !p.active) {
            if (p === scene.closest.player) scene.closest = { player: null, distance: KILL_ZONE_RADIUS };
            return;
        }
        const dist = Phaser.Math.Distance.Between(scene.zone.x, scene.zone.y, p.x, p.y);

        // Player moved out of range
        if (dist > KILL_ZONE_RADIUS) {
            if (p === scene.closest.player) {
                scene.closest = { player: null, distance: KILL_ZONE_RADIUS };
            }
            return;
        }

        // Found closer player (excluding self)
        if (dist < scene.closest.distance && p !== scene.player) {
            scene.closest = { player: p, distance: dist };
        }
    });
}
