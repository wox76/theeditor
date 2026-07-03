/**
 * Cyberpunk Shader
 * Includes: Chromatic Aberration, Scanlines, Magenta/Cyan color grading, Vignette, and Contrast Boost.
 */

import * as THREE from 'three';

export const CyberpunkShader = {

	name: 'CyberpunkShader',

	uniforms: {

		'tDiffuse': { value: null },
		'resolution': { value: new THREE.Vector2(800, 600) },
		'time': { value: 0.0 },
		'aberrationAmount': { value: 0.004 },
		'scanlineIntensity': { value: 0.2 },
		'vignetteIntensity': { value: 0.4 },
		'tintIntensity': { value: 0.6 }

	},

	vertexShader: /* glsl */`

		varying vec2 vUv;

		void main() {

			vUv = uv;
			gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );

		}`,

	fragmentShader: /* glsl */`

		uniform sampler2D tDiffuse;
		uniform vec2 resolution;
		uniform float time;
		uniform float aberrationAmount;
		uniform float scanlineIntensity;
		uniform float vignetteIntensity;
		uniform float tintIntensity;

		varying vec2 vUv;

		void main() {

			// 1. Chromatic Aberration (Color Splitting)
			vec2 uvRed = vUv + vec2(aberrationAmount, 0.0);
			vec2 uvBlue = vUv - vec2(aberrationAmount, 0.0);
			
			float r = texture2D(tDiffuse, uvRed).r;
			float g = texture2D(tDiffuse, vUv).g;
			float b = texture2D(tDiffuse, uvBlue).b;
			
			vec3 color = vec3(r, g, b);

			// 2. Cyberpunk Color Tinting (Magenta / Cyan / Neon grading)
			// Boost pinks/purples (high red/blue) and cyans (high green/blue)
			vec3 lumaCoeff = vec3(0.299, 0.587, 0.114);
			float luma = dot(color, lumaCoeff);
			
			// Cyberpunk color lookup (magenta for shadows/mids, cyan for highlights)
			vec3 shadowColor = vec3(0.9, 0.0, 0.5); // Neon Pink/Magenta
			vec3 highlightColor = vec3(0.0, 0.9, 1.0); // Neon Cyan

			// Interpolate color based on luminance
			vec3 tinted = mix(shadowColor, highlightColor, luma);
			
			// Blend original color with the cyberpunk tint
			color = mix(color, color * tinted * 1.5, tintIntensity);
			
			// Boost saturation and contrast
			color = mix(vec3(luma), color, 1.3); // Saturation
			color = clamp((color - 0.5) * 1.2 + 0.5, 0.0, 1.0); // Contrast

			// 3. Scanline Effect (Horizontal screen stripes)
			float scanline = sin(vUv.y * resolution.y * 1.5) * 0.5 + 0.5;
			color = mix(color, color * (1.0 - scanlineIntensity * 0.5), scanline);

			// 4. Vignette Effect (Dark edges)
			vec2 uvDist = vUv - vec2(0.5);
			float v = dot(uvDist, uvDist);
			color *= 1.0 - v * vignetteIntensity;

			gl_FragColor = vec4(color, 1.0);

		}`

};
